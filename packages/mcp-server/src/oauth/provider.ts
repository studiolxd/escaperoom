import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Actor } from "@escaperoom/shared/services";
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthStore } from "./store";

/**
 * Servidor de autorización OAuth 2.1 del MCP del creador (ticket 4.7, specs/10
 * §5), según la especificación de autorización de MCP:
 *
 * - **Authorization Code + PKCE** (solo `S256`) para clientes MCP remotos;
 * - metadata del servidor de autorización (RFC 8414) y del recurso protegido
 *   (RFC 9728), con indicadores de recurso (RFC 8707): el token queda ligado a
 *   `/mcp/creator`;
 * - **registro dinámico de clientes** (RFC 7591) —el cliente MCP no está dado
 *   de alta de antemano—;
 * - refresh tokens con **rotación** (clientes públicos), caducidad y
 *   **revocación** (RFC 7009).
 *
 * El login NO vive aquí: quien monta el endpoint de autorización resuelve la
 * sesión (Better Auth en la web), muestra el consentimiento y llama a
 * `approve`/`deny`. El token representa al creador con rol `member` —nunca
 * admin—: las tools aplican la misma autorización que el editor (solo sus
 * drafts). Framework-agnóstico: `Request`/`Response` web estándar.
 */

/** Único scope: operar el toolset del creador sobre sus propios drafts. */
export const MCP_CREATOR_SCOPE = "mcp:creator" as const;

/** Rutas por defecto de los endpoints OAuth (la web las sirve en `app/api/mcp/oauth`). */
export const MCP_OAUTH_PATHS = {
  authorize: "/api/mcp/oauth/authorize",
  token: "/api/mcp/oauth/token",
  register: "/api/mcp/oauth/register",
  revoke: "/api/mcp/oauth/revoke",
} as const;

/** RFC 8414 §3: metadata del servidor de autorización (issuer sin ruta). */
export const AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";
/** RFC 9728 §3: metadata del recurso protegido; se le añade la ruta del recurso. */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

const DEFAULTS = {
  accessTokenTtlSeconds: 60 * 60,
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  authorizationCodeTtlSeconds: 5 * 60,
  clientTtlSeconds: 365 * 24 * 60 * 60,
  /**
   * A-4/D-4: un cliente recién registrado por DCR (abierto, sin cuenta) solo
   * vive 1 h — el tiempo de completar un primer `authorize` — en vez de los
   * 365 días de un cliente ya en uso. `approve()` extiende el TTL a
   * `clientTtlSeconds` en cuanto un humano lo autoriza de verdad.
   */
  clientPendingTtlSeconds: 60 * 60,
};

/** Longitud máxima de `client_name`/URIs del registro dinámico (A-4/D-4). */
const MAX_CLIENT_METADATA_STRING_LENGTH = 120;

const TOKEN_AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
type TokenAuthMethod = (typeof TOKEN_AUTH_METHODS)[number];
const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

export type OAuthProviderConfig = {
  store: OAuthStore;
  /** Issuer: origen público de la app (p. ej. `https://escaperoom.app`). */
  issuer: string | URL;
  /** URL del recurso protegido: el endpoint MCP (`<origen>/mcp/creator`). */
  resource: string | URL;
  paths?: Partial<Record<keyof typeof MCP_OAUTH_PATHS, string>>;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  authorizationCodeTtlSeconds?: number;
  /** Vida de un cliente registrado por DCR; al caducar, el cliente se vuelve a registrar. */
  clientTtlSeconds?: number;
  now?: () => Date;
};

/** Cliente registrado (RFC 7591). El secreto, si lo hay, solo se guarda hasheado. */
export type OAuthClientRecord = {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: TokenAuthMethod;
  scope: string;
  client_id_issued_at: number;
  client_secret_hash?: string;
};

/** Datos comunes de un grant: quién, con qué cliente y para qué recurso. */
type GrantRecord = {
  userId: string;
  organizationId: string | null;
  clientId: string;
  scope: string;
  resource: string;
  /** Familia de tokens de una autorización: se revoca entera. */
  grantId: string;
};
type CodeRecord = GrantRecord & {
  redirectUri: string;
  /** A-14: si `redirect_uri` vino explícita en `authorize`, repetirla al canjear es obligatorio. */
  redirectUriExplicit: boolean;
  codeChallenge: string;
  expiresAt: number;
};
type TokenRecord = GrantRecord & { expiresAt: number };

/** Petición de autorización ya validada: lo que muestra el consentimiento. */
export type AuthorizationRequest = {
  clientId: string;
  clientName: string;
  clientUri?: string;
  redirectUri: string;
  /** A-14: `true` si el cliente envió `redirect_uri` explícita en `authorize`. */
  redirectUriExplicit: boolean;
  state?: string;
  codeChallenge: string;
  scope: string;
  resource: string;
};

export type AuthorizationRequestResult =
  | { ok: true; request: AuthorizationRequest }
  /**
   * Error. Con `redirectTo` se devuelve al cliente (RFC 6749 §4.1.2.1); sin
   * él (cliente o `redirect_uri` no fiables) se muestra al usuario y NO se
   * redirige.
   */
  | { ok: false; error: string; description: string; redirectTo?: URL };

export type AccessTokenCheck =
  | {
      ok: true;
      actor: Actor;
      /** Id de la autorización (familia de tokens): clave del rate limit. */
      grantId: string;
      clientId: string;
      scope: string;
      expiresAt: Date;
    }
  | { ok: false; error: "invalid_token"; description: string };

export type OAuthProvider = ReturnType<typeof createOAuthProvider>;

const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");
const randomToken = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

function sameSecretHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Normaliza una URL de recurso para compararla (sin fragmento ni `/` final). */
function normalizeResource(value: string | URL): string {
  const url = new URL(value);
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

/** `true` si `value` (parámetro `resource`, RFC 8707) designa el recurso `resource`. */
function isResource(value: string, resource: string): boolean {
  try {
    return normalizeResource(value) === resource;
  } catch {
    return false;
  }
}

/** Datos del grant de un código o token (sin sus campos propios). */
function grantOf(record: GrantRecord): GrantRecord {
  const { userId, organizationId, clientId, scope, resource, grantId } = record;
  return { userId, organizationId, clientId, scope, resource, grantId };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
  "about:",
]);

/**
 * `redirect_uri` admisible al registrar (OAuth 2.1 §2.3, RFC 8252): https,
 * http solo en loopback, o esquema privado de app nativa; nunca con fragmento.
 */
function redirectUriProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `redirect_uri no es una URL válida: ${value}`;
  }
  if (url.hash) return `redirect_uri no puede llevar fragmento: ${value}`;
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return `esquema no permitido en redirect_uri: ${value}`;
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    return `http solo se admite en loopback (localhost/127.0.0.1): ${value}`;
  }
  return null;
}

/**
 * Coincidencia de `redirect_uri` con una registrada: exacta, salvo el puerto
 * de las redirecciones loopback (RFC 8252 §7.3, las apps nativas eligen un
 * puerto libre al vuelo).
 */
function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  try {
    const a = new URL(requested);
    const b = new URL(registered);
    return (
      a.protocol === "http:" &&
      b.protocol === "http:" &&
      LOOPBACK_HOSTS.has(a.hostname) &&
      a.hostname === b.hostname &&
      a.pathname === b.pathname &&
      a.search === b.search
    );
  } catch {
    return false;
  }
}

/** PKCE S256 (RFC 7636 §4.6). */
function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return sameSecretHash(sha256(verifier), challenge);
}

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" } as const;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Error OAuth (RFC 6749 §5.2) sin caché. */
function oauthError(
  error: string,
  description: string,
  status = 400,
  headers: Record<string, string> = {},
): Response {
  return json({ error, error_description: description }, status, { ...NO_STORE, ...headers });
}

/** Lee un cuerpo `application/x-www-form-urlencoded` (o JSON, por tolerancia). */
async function readForm(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }
  return new URLSearchParams(await request.text());
}

/** Clave del almacén para cada tipo de registro (los tokens, por su hash). */
const keys = {
  client: (clientId: string) => `client:${clientId}`,
  code: (code: string) => `code:${sha256(code)}`,
  access: (token: string) => `access:${sha256(token)}`,
  refresh: (token: string) => `refresh:${sha256(token)}`,
  /** A-6: marca de un refresh ya canjeado, para detectar su reutilización tras rotarlo. */
  usedRefresh: (token: string) => `used-refresh:${sha256(token)}`,
  revokedGrant: (grantId: string) => `revoked-grant:${grantId}`,
};

export function createOAuthProvider(config: OAuthProviderConfig) {
  const store = config.store;
  const now = config.now ?? (() => new Date());
  const issuer = new URL(config.issuer).origin;
  const resource = normalizeResource(config.resource);
  const resourcePath = new URL(resource).pathname.replace(/\/$/, "");
  const paths = { ...MCP_OAUTH_PATHS, ...config.paths };
  const ttl = {
    access: config.accessTokenTtlSeconds ?? DEFAULTS.accessTokenTtlSeconds,
    refresh: config.refreshTokenTtlSeconds ?? DEFAULTS.refreshTokenTtlSeconds,
    code: config.authorizationCodeTtlSeconds ?? DEFAULTS.authorizationCodeTtlSeconds,
    client: config.clientTtlSeconds ?? DEFAULTS.clientTtlSeconds,
    clientPending: DEFAULTS.clientPendingTtlSeconds,
  };
  const endpoint = (path: string) => new URL(path, issuer).href;
  const expiresIn = (seconds: number) => new Date(now().getTime() + seconds * 1000);
  const protectedResourceMetadataUrl = `${issuer}${PROTECTED_RESOURCE_METADATA_PATH}${resourcePath}`;

  async function isRevoked(grantId: string): Promise<boolean> {
    return (await store.get(keys.revokedGrant(grantId))) !== null;
  }

  async function revokeGrant(grantId: string): Promise<void> {
    // La marca sobrevive a cualquier token de la familia (el refresh es el más largo).
    await store.put(
      keys.revokedGrant(grantId),
      { revokedAt: now().toISOString() },
      expiresIn(ttl.refresh),
    );
  }

  /** Emite un par access + refresh para la autorización `grant`. */
  async function issueTokens(grant: GrantRecord): Promise<Response> {
    const accessToken = randomToken("mcpat_");
    const refreshToken = randomToken("mcprt_");
    const accessExpires = expiresIn(ttl.access);
    const refreshExpires = expiresIn(ttl.refresh);
    await store.put(
      keys.access(accessToken),
      { ...grant, expiresAt: accessExpires.getTime() } satisfies TokenRecord,
      accessExpires,
    );
    await store.put(
      keys.refresh(refreshToken),
      { ...grant, expiresAt: refreshExpires.getTime() } satisfies TokenRecord,
      refreshExpires,
    );
    return json(
      {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ttl.access,
        refresh_token: refreshToken,
        scope: grant.scope,
      },
      200,
      NO_STORE,
    );
  }

  /**
   * Autentica al cliente en el endpoint de token/revocación según su método
   * registrado (RFC 6749 §2.3). Devuelve el cliente o la respuesta de error.
   */
  async function authenticateClient(
    request: Request,
    form: URLSearchParams,
  ): Promise<OAuthClientRecord | Response> {
    let clientId = form.get("client_id") ?? undefined;
    let secret = form.get("client_secret") ?? undefined;
    const authorization = request.headers.get("authorization");
    const usedBasic = !!authorization?.toLowerCase().startsWith("basic ");
    if (usedBasic) {
      const decoded = Buffer.from(authorization!.slice(6).trim(), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 0) return oauthError("invalid_client", "Cabecera Basic mal formada", 401);
      clientId = decodeURIComponent(decoded.slice(0, colon));
      secret = decodeURIComponent(decoded.slice(colon + 1));
    }
    const challenge: Record<string, string> = usedBasic
      ? { "www-authenticate": 'Basic realm="escaperoom-creator"' }
      : {};
    if (!clientId) return oauthError("invalid_client", "Falta client_id", 401, challenge);
    const client = await store.get<OAuthClientRecord>(keys.client(clientId));
    if (!client) {
      return oauthError(
        "invalid_client",
        "Cliente desconocido o caducado: vuelve a registrarlo",
        401,
        challenge,
      );
    }
    if (client.token_endpoint_auth_method !== "none") {
      if (
        !secret ||
        !client.client_secret_hash ||
        !sameSecretHash(sha256(secret), client.client_secret_hash)
      ) {
        return oauthError("invalid_client", "Credenciales del cliente incorrectas", 401, challenge);
      }
    }
    return client;
  }

  return {
    issuer,
    resource,
    protectedResourceMetadataUrl,
    endpoints: {
      authorize: endpoint(paths.authorize),
      token: endpoint(paths.token),
      register: endpoint(paths.register),
      revoke: endpoint(paths.revoke),
    },

    /** RFC 8414: metadata del servidor de autorización. */
    authorizationServerMetadata() {
      return {
        issuer,
        authorization_endpoint: endpoint(paths.authorize),
        token_endpoint: endpoint(paths.token),
        registration_endpoint: endpoint(paths.register),
        revocation_endpoint: endpoint(paths.revoke),
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: [...GRANT_TYPES],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [...TOKEN_AUTH_METHODS],
        revocation_endpoint_auth_methods_supported: [...TOKEN_AUTH_METHODS],
        scopes_supported: [MCP_CREATOR_SCOPE],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: false,
      };
    },

    /** RFC 9728: metadata del recurso protegido (`/mcp/creator`). */
    protectedResourceMetadata() {
      return {
        resource,
        authorization_servers: [issuer],
        scopes_supported: [MCP_CREATOR_SCOPE],
        bearer_methods_supported: ["header"],
        resource_name: "Escape Room — MCP del creador",
      };
    },

    /** Respuesta JSON de una metadata (pública, cacheable un rato, CORS abierto). */
    metadataResponse(body: unknown): Response {
      return json(body, 200, {
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      });
    },

    /** `POST register` — registro dinámico de clientes (RFC 7591). */
    async handleRegister(request: Request): Promise<Response> {
      const raw = await request.json().catch(() => null);
      const parsed = OAuthClientMetadataSchema.safeParse(raw);
      if (!parsed.success) {
        return oauthError(
          "invalid_client_metadata",
          `Metadata de cliente inválida: ${parsed.error.message}`,
        );
      }
      const metadata = parsed.data;
      // A-4/D-4: el SDK no acota la longitud de `client_name`/URIs; sin tope,
      // un registro abierto puede meter cualquier cadena arbitraria (incluida
      // en la pantalla de consentimiento).
      if ((metadata.client_name?.length ?? 0) > MAX_CLIENT_METADATA_STRING_LENGTH) {
        return oauthError(
          "invalid_client_metadata",
          `client_name no puede superar ${MAX_CLIENT_METADATA_STRING_LENGTH} caracteres`,
        );
      }
      if ((metadata.client_uri?.length ?? 0) > MAX_CLIENT_METADATA_STRING_LENGTH) {
        return oauthError(
          "invalid_client_metadata",
          `client_uri no puede superar ${MAX_CLIENT_METADATA_STRING_LENGTH} caracteres`,
        );
      }
      for (const uri of metadata.redirect_uris) {
        if (uri.length > MAX_CLIENT_METADATA_STRING_LENGTH) {
          return oauthError(
            "invalid_redirect_uri",
            `redirect_uri no puede superar ${MAX_CLIENT_METADATA_STRING_LENGTH} caracteres`,
          );
        }
        const problem = redirectUriProblem(uri);
        if (problem) return oauthError("invalid_redirect_uri", problem);
      }
      const grantTypes = metadata.grant_types ?? [...GRANT_TYPES];
      const unsupportedGrant = grantTypes.find(
        (g) => !(GRANT_TYPES as readonly string[]).includes(g),
      );
      if (unsupportedGrant) {
        return oauthError(
          "invalid_client_metadata",
          `grant_type no soportado: ${unsupportedGrant}`,
        );
      }
      const responseTypes = metadata.response_types ?? ["code"];
      if (responseTypes.some((t) => t !== "code")) {
        return oauthError("invalid_client_metadata", 'Solo se admite response_type "code"');
      }
      const method = (metadata.token_endpoint_auth_method ?? "none") as TokenAuthMethod;
      if (!TOKEN_AUTH_METHODS.includes(method)) {
        return oauthError(
          "invalid_client_metadata",
          `token_endpoint_auth_method no soportado: ${method}. Usa ${TOKEN_AUTH_METHODS.join(", ")}`,
        );
      }
      const clientId = randomUUID();
      const secret = method === "none" ? undefined : randomToken("mcpcs_");
      const issuedAt = Math.floor(now().getTime() / 1000);
      const record: OAuthClientRecord = {
        client_id: clientId,
        ...(metadata.client_name ? { client_name: metadata.client_name } : {}),
        ...(metadata.client_uri ? { client_uri: metadata.client_uri } : {}),
        redirect_uris: metadata.redirect_uris,
        grant_types: grantTypes,
        response_types: responseTypes,
        token_endpoint_auth_method: method,
        scope: MCP_CREATOR_SCOPE,
        client_id_issued_at: issuedAt,
        ...(secret ? { client_secret_hash: sha256(secret) } : {}),
      };
      // A-4/D-4: TTL corto hasta el primer `authorize` aprobado por un humano
      // (`approve()` lo extiende a `ttl.client`) — un registro abierto sin
      // cuenta detrás no debe poder dejar filas vivas un año sin usarse nunca.
      await store.put(keys.client(clientId), record, expiresIn(ttl.clientPending));
      const publicInfo: Partial<OAuthClientRecord> = { ...record };
      delete publicInfo.client_secret_hash;
      return json(
        {
          ...publicInfo,
          ...(secret
            ? { client_secret: secret, client_secret_expires_at: issuedAt + ttl.client }
            : {}),
        },
        201,
        { ...NO_STORE, "access-control-allow-origin": "*" },
      );
    },

    /**
     * Valida los parámetros de `GET authorize` (o los que reenvía el
     * formulario de consentimiento). No crea nada.
     */
    async parseAuthorizationRequest(params: URLSearchParams): Promise<AuthorizationRequestResult> {
      const clientId = params.get("client_id");
      if (!clientId) return { ok: false, error: "invalid_request", description: "Falta client_id" };
      const client = await store.get<OAuthClientRecord>(keys.client(clientId));
      if (!client) {
        return {
          ok: false,
          error: "invalid_client",
          description: "Cliente desconocido o caducado",
        };
      }
      const requestedRedirect = params.get("redirect_uri");
      let redirectUri: string | undefined;
      if (requestedRedirect) {
        redirectUri = client.redirect_uris.some((r) => redirectUriMatches(requestedRedirect, r))
          ? requestedRedirect
          : undefined;
      } else if (client.redirect_uris.length === 1) {
        redirectUri = client.redirect_uris[0];
      }
      // A-14: solo cuenta como "explícita" si vino en la query Y se validó
      // contra el cliente — no el valor por defecto cuando el cliente solo
      // tiene una `redirect_uri` registrada.
      const redirectUriExplicit = Boolean(requestedRedirect) && redirectUri === requestedRedirect;
      if (!redirectUri) {
        return {
          ok: false,
          error: "invalid_request",
          description: "redirect_uri ausente o no registrada para este cliente",
        };
      }
      const state = params.get("state") ?? undefined;
      const fail = (error: string, description: string): AuthorizationRequestResult => {
        const to = new URL(redirectUri);
        to.searchParams.set("error", error);
        to.searchParams.set("error_description", description);
        if (state) to.searchParams.set("state", state);
        to.searchParams.set("iss", issuer);
        return { ok: false, error, description, redirectTo: to };
      };
      if (params.get("response_type") !== "code") {
        return fail("unsupported_response_type", 'Solo se admite response_type "code"');
      }
      const codeChallenge = params.get("code_challenge");
      if (!codeChallenge) return fail("invalid_request", "PKCE obligatorio: falta code_challenge");
      if ((params.get("code_challenge_method") ?? "plain") !== "S256") {
        return fail("invalid_request", 'PKCE: solo se admite code_challenge_method "S256"');
      }
      const requestedResource = params.get("resource");
      if (requestedResource) {
        if (!isResource(requestedResource, resource)) {
          return fail(
            "invalid_target",
            `Recurso desconocido: este servidor solo autoriza ${resource}`,
          );
        }
      }
      return {
        ok: true,
        request: {
          clientId,
          clientName: client.client_name ?? clientId,
          ...(client.client_uri ? { clientUri: client.client_uri } : {}),
          redirectUri,
          redirectUriExplicit,
          ...(state ? { state } : {}),
          codeChallenge,
          // Único scope posible; los que pida el cliente de más se ignoran.
          scope: MCP_CREATOR_SCOPE,
          resource,
        },
      };
    },

    /** El creador acepta: emite el código y devuelve la redirección al cliente. */
    async approve(request: AuthorizationRequest, actor: Actor): Promise<URL> {
      // A-4/D-4: un humano acaba de autorizar este cliente de verdad — deja de
      // tener el TTL corto del registro pendiente (`ttl.clientPending`) y pasa
      // al TTL normal de un cliente en uso.
      const client = await store.get<OAuthClientRecord>(keys.client(request.clientId));
      if (client) await store.put(keys.client(request.clientId), client, expiresIn(ttl.client));

      const code = randomToken("mcpac_");
      const record: CodeRecord = {
        userId: actor.userId,
        organizationId: actor.organizationId ?? null,
        clientId: request.clientId,
        scope: request.scope,
        resource: request.resource,
        grantId: randomUUID(),
        redirectUri: request.redirectUri,
        redirectUriExplicit: request.redirectUriExplicit,
        codeChallenge: request.codeChallenge,
        expiresAt: expiresIn(ttl.code).getTime(),
      };
      await store.put(keys.code(code), record, new Date(record.expiresAt));
      const to = new URL(request.redirectUri);
      to.searchParams.set("code", code);
      if (request.state) to.searchParams.set("state", request.state);
      to.searchParams.set("iss", issuer);
      return to;
    },

    /** El creador rechaza: redirección con `access_denied`. */
    deny(request: AuthorizationRequest): URL {
      const to = new URL(request.redirectUri);
      to.searchParams.set("error", "access_denied");
      to.searchParams.set("error_description", "El creador ha denegado el acceso");
      if (request.state) to.searchParams.set("state", request.state);
      to.searchParams.set("iss", issuer);
      return to;
    },

    /** `POST token` — grants `authorization_code` (con PKCE) y `refresh_token` (rotación). */
    async handleToken(request: Request): Promise<Response> {
      const form = await readForm(request);
      const client = await authenticateClient(request, form);
      if (client instanceof Response) return client;
      const grantType = form.get("grant_type");
      const requestedResource = form.get("resource");
      if (requestedResource) {
        if (!isResource(requestedResource, resource)) {
          return oauthError(
            "invalid_target",
            `Recurso desconocido: este servidor solo autoriza ${resource}`,
          );
        }
      }

      if (grantType === "authorization_code") {
        const code = form.get("code");
        const verifier = form.get("code_verifier");
        if (!code) return oauthError("invalid_request", "Falta code");
        if (!verifier)
          return oauthError("invalid_request", "PKCE obligatorio: falta code_verifier");
        // Un solo canje: el código se consume aunque luego falle la validación.
        const record = await store.take<CodeRecord>(keys.code(code));
        if (!record || record.expiresAt <= now().getTime()) {
          return oauthError(
            "invalid_grant",
            "Código de autorización inválido, caducado o ya usado",
          );
        }
        if (record.clientId !== client.client_id) {
          return oauthError("invalid_grant", "El código no pertenece a este cliente");
        }
        const redirectUri = form.get("redirect_uri");
        // A-14 (OAuth 2.1 §4.1.3): si vino explícita en `authorize`, repetirla
        // aquí es obligatorio, no opcional — PKCE mitiga la sustitución del
        // código, pero la RFC la exige igualmente.
        if (record.redirectUriExplicit && !redirectUri) {
          return oauthError(
            "invalid_request",
            "Falta redirect_uri: se envió explícita al autorizar y hay que repetirla al canjear el código",
          );
        }
        if (redirectUri && redirectUri !== record.redirectUri) {
          return oauthError("invalid_grant", "redirect_uri no coincide con la de la autorización");
        }
        if (!verifyPkce(verifier, record.codeChallenge)) {
          return oauthError(
            "invalid_grant",
            "PKCE: code_verifier no corresponde al code_challenge",
          );
        }
        return issueTokens(grantOf(record));
      }

      if (grantType === "refresh_token") {
        const refreshToken = form.get("refresh_token");
        if (!refreshToken) return oauthError("invalid_request", "Falta refresh_token");
        // Rotación (OAuth 2.1 §4.3.1): el refresh usado deja de valer.
        const record = await store.take<TokenRecord>(keys.refresh(refreshToken));
        if (!record || record.expiresAt <= now().getTime()) {
          // A-6: si el refresh ya se había canjeado antes (queda la marca de
          // `usedRefresh` con su `grantId` hasta que caduque), esto es
          // reutilización de un token robado/duplicado — se revoca la familia
          // entera, no solo se rechaza esta llamada.
          const reused = await store.get<{ grantId: string }>(keys.usedRefresh(refreshToken));
          if (reused) await revokeGrant(reused.grantId);
          return oauthError("invalid_grant", "Refresh token inválido, caducado o ya usado");
        }
        if (record.clientId !== client.client_id) {
          return oauthError("invalid_grant", "El refresh token no pertenece a este cliente");
        }
        if (await isRevoked(record.grantId)) {
          return oauthError("invalid_grant", "La autorización ha sido revocada");
        }
        await store.put(
          keys.usedRefresh(refreshToken),
          { grantId: record.grantId },
          new Date(record.expiresAt),
        );
        return issueTokens(grantOf(record));
      }

      return oauthError(
        "unsupported_grant_type",
        `grant_type no soportado: ${grantType ?? "(vacío)"}. Usa ${GRANT_TYPES.join(" o ")}`,
      );
    },

    /**
     * `POST revoke` (RFC 7009): revoca la autorización entera del token
     * (access y refresh de la misma familia). Responde 200 aunque el token no
     * exista, como pide la RFC.
     */
    async handleRevoke(request: Request): Promise<Response> {
      const form = await readForm(request);
      const client = await authenticateClient(request, form);
      if (client instanceof Response) return client;
      const token = form.get("token");
      if (!token) return oauthError("invalid_request", "Falta token");
      const order =
        form.get("token_type_hint") === "refresh_token"
          ? [keys.refresh(token), keys.access(token)]
          : [keys.access(token), keys.refresh(token)];
      for (const key of order) {
        const record = await store.get<TokenRecord>(key);
        if (!record) continue;
        // Se marca la familia; el registro se conserva hasta su caducidad para
        // responder "revocado" (y no "desconocido") a quien lo siga usando.
        if (record.clientId === client.client_id) await revokeGrant(record.grantId);
        break;
      }
      return new Response(null, { status: 200, headers: { ...NO_STORE } });
    },

    /** Revoca una autorización por id (p. ej. desde un panel del creador). */
    revokeGrant,

    /**
     * Valida un access token del transporte HTTP: existe, no ha caducado, no
     * está revocado y es para ESTE recurso. Devuelve el actor del creador.
     */
    async verifyAccessToken(token: string): Promise<AccessTokenCheck> {
      const record = await store.get<TokenRecord>(keys.access(token));
      if (!record || record.expiresAt <= now().getTime()) {
        return {
          ok: false,
          error: "invalid_token",
          description: "El token de acceso no es válido o ha caducado",
        };
      }
      if (await isRevoked(record.grantId)) {
        return {
          ok: false,
          error: "invalid_token",
          description: "El token de acceso ha sido revocado",
        };
      }
      if (record.resource !== resource) {
        return {
          ok: false,
          error: "invalid_token",
          description: "El token no es para este recurso",
        };
      }
      return {
        ok: true,
        // Siempre `member`: el token nunca eleva privilegios (solo sus drafts).
        actor: { userId: record.userId, organizationId: record.organizationId, role: "member" },
        grantId: record.grantId,
        clientId: record.clientId,
        scope: record.scope,
        expiresAt: new Date(record.expiresAt),
      };
    },
  };
}
