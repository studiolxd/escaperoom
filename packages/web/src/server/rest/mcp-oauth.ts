import { DEFAULT_LOCALE, LOCALES } from "@escaperoom/config/locales";
import type { OAuthProvider, RateLimiter } from "@escaperoom/mcp-server";
import { isAnonymous, type Actor } from "@escaperoom/shared/services";

/**
 * Endpoints OAuth 2.1 del MCP del creador (ticket 4.7, specs/10 §5): metadata,
 * registro dinámico, autorización con consentimiento sobre la sesión de Better
 * Auth, token y revocación. La lógica del protocolo vive en
 * `@escaperoom/mcp-server` (`createOAuthProvider`); aquí solo el cableado HTTP
 * de Next, testeable sin Postgres.
 */
export type McpOAuthHandlerDeps = {
  /** Proveedor OAuth para el origen de la petición. */
  provider: (request: Request) => OAuthProvider;
  /** Actor de la sesión de Better Auth (anónimo si no hay sesión). */
  resolveActor: (request: Request) => Promise<Actor>;
  /** Límite de registros dinámicos por IP (anti-spam del endpoint abierto). */
  registerLimiter?: RateLimiter;
};

/** Ruta (sin locale) de la pantalla de consentimiento. */
export const MCP_CONSENT_PATH = "/oauth/consent";

/** Cabeceras CORS de los endpoints que llaman los clientes MCP (también desde navegador). */
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Locale de la pantalla de consentimiento: cookie de next-intl o el por defecto. */
function localeOf(request: Request): string {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  const locale = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  return locale && (LOCALES as readonly string[]).includes(locale) ? locale : DEFAULT_LOCALE;
}

function consentUrl(request: Request, params: URLSearchParams): URL {
  const url = new URL(`/${localeOf(request)}${MCP_CONSENT_PATH}`, request.url);
  url.search = params.toString();
  return url;
}

/**
 * Anti-CSRF del formulario de consentimiento: además de la cookie de sesión
 * `SameSite=Lax`, el POST debe venir de la propia app (`Origin` o, si el
 * navegador no lo manda, `Sec-Fetch-Site: same-origin`).
 */
function isSameOrigin(request: Request, allowed: string[]): boolean {
  const origin = request.headers.get("origin");
  if (origin) return allowed.includes(origin);
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "desconocida"
  );
}

export function createMcpOAuthHandlers(deps: McpOAuthHandlerDeps) {
  return {
    /** `GET /.well-known/oauth-authorization-server` (RFC 8414). */
    authorizationServerMetadata(request: Request): Response {
      const provider = deps.provider(request);
      return provider.metadataResponse(provider.authorizationServerMetadata());
    },

    /** `GET /.well-known/oauth-protected-resource[/mcp/creator]` (RFC 9728). */
    protectedResourceMetadata(request: Request): Response {
      const provider = deps.provider(request);
      return provider.metadataResponse(provider.protectedResourceMetadata());
    },

    /** Preflight CORS. */
    options(): Response {
      return new Response(null, { status: 204, headers: CORS });
    },

    /** `POST /api/mcp/oauth/register` — registro dinámico (RFC 7591). */
    async register(request: Request): Promise<Response> {
      const decision = deps.registerLimiter?.consume(`register:${clientIp(request)}`);
      if (decision && !decision.ok) {
        return withCors(
          Response.json(
            {
              error: "rate_limited",
              error_description: `Demasiados registros de clientes. Reintenta en ${decision.retryAfterSeconds} s.`,
            },
            { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
          ),
        );
      }
      return withCors(await deps.provider(request).handleRegister(request));
    },

    /** `POST /api/mcp/oauth/token`. */
    async token(request: Request): Promise<Response> {
      return withCors(await deps.provider(request).handleToken(request));
    },

    /** `POST /api/mcp/oauth/revoke` (RFC 7009). */
    async revoke(request: Request): Promise<Response> {
      return withCors(await deps.provider(request).handleRevoke(request));
    },

    /**
     * `GET /api/mcp/oauth/authorize` — el cliente MCP abre aquí el navegador.
     * Un error que se puede devolver al cliente vuelve por su `redirect_uri`;
     * lo demás (incluidos cliente o `redirect_uri` inválidos, que se muestran
     * al usuario sin redirigir) va a la pantalla de consentimiento.
     */
    async authorize(request: Request): Promise<Response> {
      const params = new URL(request.url).searchParams;
      const parsed = await deps.provider(request).parseAuthorizationRequest(params);
      if (!parsed.ok && parsed.redirectTo) return Response.redirect(parsed.redirectTo, 302);
      return Response.redirect(consentUrl(request, params), 302);
    },

    /**
     * `POST /api/mcp/oauth/authorize` — decisión del formulario de
     * consentimiento (`decision=approve|deny` + los parámetros originales).
     * Revalida todo: sesión, origen y petición de autorización.
     */
    async decide(request: Request): Promise<Response> {
      const provider = deps.provider(request);
      if (!isSameOrigin(request, [provider.issuer, new URL(request.url).origin])) {
        return Response.json(
          { error: "forbidden", error_description: "Origen no permitido" },
          { status: 403 },
        );
      }
      const form = await request.formData().catch(() => null);
      if (!form) {
        return Response.json(
          { error: "invalid_request", error_description: "Formulario inválido" },
          { status: 400 },
        );
      }
      const params = new URLSearchParams();
      let decision: string | null = null;
      for (const [key, value] of form.entries()) {
        if (typeof value !== "string") continue;
        if (key === "decision") decision = value;
        else params.set(key, value);
      }
      const actor = await deps.resolveActor(request);
      // Sin sesión (caducó mientras decidía): de vuelta al consentimiento, que pide login.
      if (isAnonymous(actor)) return Response.redirect(consentUrl(request, params), 303);

      const parsed = await provider.parseAuthorizationRequest(params);
      if (!parsed.ok) {
        return parsed.redirectTo
          ? Response.redirect(parsed.redirectTo, 303)
          : Response.redirect(consentUrl(request, params), 303);
      }
      const to =
        decision === "approve"
          ? await provider.approve(parsed.request, actor)
          : provider.deny(parsed.request);
      return Response.redirect(to, 303);
    },
  };
}
