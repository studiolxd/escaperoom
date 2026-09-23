import type { Actor } from "@escaperoom/shared/services";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  AUTHORIZATION_SERVER_METADATA_PATH,
  authenticateOAuthBearer,
  createInMemoryOAuthStore,
  createOAuthProvider,
  MCP_OAUTH_PATHS,
  PROTECTED_RESOURCE_METADATA_PATH,
  startHttpServer,
  type CreatorMcpDeps,
  type OAuthProvider,
  type RateLimiter,
  type RunningHttpServer,
} from "../../src";

/** Cabecera de TEST que hace de sesión de Better Auth en la pantalla de consentimiento. */
export const TEST_SESSION_HEADER = "x-test-session";

export type OAuthTestServer = {
  http: RunningHttpServer;
  provider: OAuthProvider;
  /** Reloj controlable del servidor de autorización (caducidades). */
  clock: { now: number };
  close(): Promise<void>;
};

/**
 * Servidor HTTP de test con el MCP en `/mcp/creator` protegido por OAuth y
 * los endpoints del servidor de autorización montados como los sirve la web:
 * metadata (`/.well-known/…`), registro, autorización, token y revocación.
 * El "consentimiento" de test aprueba si la petición trae la sesión de test.
 */
export async function startOAuthTestServer(
  deps: Omit<CreatorMcpDeps, "actor">,
  options: { rateLimiter?: RateLimiter; accessTokenTtlSeconds?: number } = {},
): Promise<OAuthTestServer> {
  const clock = { now: Date.now() };
  const now = () => new Date(clock.now);
  const store = createInMemoryOAuthStore(now);
  // El issuer depende del puerto: el proveedor se crea al arrancar el servidor.
  const ref: { provider?: OAuthProvider } = {};

  const http = await startHttpServer({
    port: 0,
    authenticate: (request) => authenticateOAuthBearer(ref.provider!, request),
    resourceMetadataUrl: () => ref.provider!.protectedResourceMetadataUrl,
    ...(options.rateLimiter ? { rateLimiter: options.rateLimiter } : {}),
    createDeps: () => deps,
    fallback: async (request) => {
      const provider = ref.provider!;
      const url = new URL(request.url);
      switch (url.pathname) {
        case `${PROTECTED_RESOURCE_METADATA_PATH}/mcp/creator`:
          return provider.metadataResponse(provider.protectedResourceMetadata());
        case AUTHORIZATION_SERVER_METADATA_PATH:
          return provider.metadataResponse(provider.authorizationServerMetadata());
        case MCP_OAUTH_PATHS.register:
          return provider.handleRegister(request);
        case MCP_OAUTH_PATHS.token:
          return provider.handleToken(request);
        case MCP_OAUTH_PATHS.revoke:
          return provider.handleRevoke(request);
        case MCP_OAUTH_PATHS.authorize: {
          const parsed = await provider.parseAuthorizationRequest(url.searchParams);
          if (!parsed.ok) {
            return parsed.redirectTo
              ? Response.redirect(parsed.redirectTo, 302)
              : Response.json(parsed, { status: 400 });
          }
          const userId = request.headers.get(TEST_SESSION_HEADER);
          if (!userId) return new Response("login", { status: 401 });
          const actor: Actor = { userId, organizationId: null, role: "member" };
          const decision = url.searchParams.get("test_decision");
          const to =
            decision === "deny"
              ? provider.deny(parsed.request)
              : await provider.approve(parsed.request, actor);
          return Response.redirect(to, 302);
        }
        default:
          return new Response(null, { status: 404 });
      }
    },
  });
  const provider = createOAuthProvider({
    store,
    issuer: http.url.origin,
    resource: http.url,
    now,
    ...(options.accessTokenTtlSeconds
      ? { accessTokenTtlSeconds: options.accessTokenTtlSeconds }
      : {}),
  });
  ref.provider = provider;
  return { http, provider, clock, close: () => http.close() };
}

/**
 * Cliente OAuth de TEST para el SDK de MCP (`OAuthClientProvider`): guarda
 * cliente, verifier y tokens en memoria y, en vez de abrir un navegador, apunta
 * la URL de autorización para que el test haga de creador que consiente.
 */
export class TestOAuthClient implements OAuthClientProvider {
  readonly redirectUrl = "http://127.0.0.1:33418/callback";
  client?: OAuthClientInformationMixed;
  savedTokens?: OAuthTokens;
  verifier?: string;
  authorizationUrl?: URL;

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Cliente MCP de test",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    return "estado-de-test";
  }
  clientInformation() {
    return this.client;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.client = info;
  }
  tokens() {
    return this.savedTokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.savedTokens = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    if (!this.verifier) throw new Error("sin code verifier");
    return this.verifier;
  }
}

/**
 * El creador `userId` abre la URL de autorización con su sesión y consiente:
 * devuelve la redirección al cliente (con `code` o `error`).
 */
export async function consent(
  authorizationUrl: URL,
  userId: string,
  decision: "approve" | "deny" = "approve",
): Promise<URL> {
  const url = new URL(authorizationUrl);
  if (decision === "deny") url.searchParams.set("test_decision", "deny");
  const response = await fetch(url, {
    headers: { [TEST_SESSION_HEADER]: userId },
    redirect: "manual",
  });
  const location = response.headers.get("location");
  if (response.status !== 302 || !location) {
    throw new Error(`consentimiento sin redirección: ${response.status} ${await response.text()}`);
  }
  return new URL(location);
}
