import {
  authenticateOAuthBearer,
  bearerToken,
  createOAuthProvider,
  createRateLimiter,
  MCP_ENDPOINT,
  type HttpAuthenticator,
  type OAuthProvider,
  type OAuthStore,
  type RateLimiter,
} from "@escaperoom/mcp-server";
import { prisma } from "@escaperoom/shared/db";
import { resolveActorFromRequest, resolveBrowserActorFromRequest } from "./context";
import { createPrismaOAuthStore } from "./mcp-oauth-store";
import { consumeRateLimit } from "./rate-limit";
import { createMcpOAuthHandlers, type McpRegisterRateLimiter } from "./rest/mcp-oauth";

/**
 * Composition root del OAuth 2.1 del MCP del creador (ticket 4.7): proveedor
 * sobre la tabla `verification`, límites de uso y el autenticador de
 * `/mcp/creator`.
 */

let store: OAuthStore | undefined;
const providers = new Map<string, OAuthProvider>();
let toolRateLimiter: RateLimiter | undefined;

/**
 * Cuota del registro dinámico (A-4/D-4): a diferencia del limitador de tools
 * (en memoria, por proceso — está bien porque cada token ya está autenticado),
 * este endpoint es público y sin sesión, así que su cuota vive en Redis
 * (política `mcp-register`, `@escaperoom/kit/rate-limit`) con `clientIpFromHeaders`
 * (antes se usaba la primera entrada de `x-forwarded-for`, que escribe el
 * cliente).
 */
const checkRegisterRateLimit: McpRegisterRateLimiter = async (request) => {
  const result = await consumeRateLimit("mcp-register", request);
  return result.ok ? { ok: true } : { ok: false, retryAfterSeconds: result.retryAfter };
};

/**
 * Origen público de la app: `BETTER_AUTH_URL` (o `NEXT_PUBLIC_APP_URL`) si
 * está definido —detrás de un proxy, `request.url` puede ser interno—; si no,
 * el de la petición (desarrollo).
 */
export function publicOrigin(requestUrl: string | URL): string {
  const configured = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  return new URL(configured || requestUrl).origin;
}

/** Proveedor OAuth del origen de la petición (issuer = origen, recurso = `/mcp/creator`). */
export function getMcpOAuthProvider(request: Request | { url: string }): OAuthProvider {
  const origin = publicOrigin(request.url);
  let provider = providers.get(origin);
  if (!provider) {
    store ??= createPrismaOAuthStore(prisma.verification);
    provider = createOAuthProvider({
      store,
      issuer: origin,
      resource: new URL(MCP_ENDPOINT, origin),
    });
    providers.set(origin, provider);
  }
  return provider;
}

/** Límite de llamadas a tools por token (60/min por defecto; ver README del MCP). */
export function getMcpToolRateLimiter(): RateLimiter {
  toolRateLimiter ??= createRateLimiter();
  return toolRateLimiter;
}

/**
 * Identidad de `/mcp/creator`: con `Authorization: Bearer`, SOLO el access
 * token OAuth (un token inválido es 401 `invalid_token`, sin probar otra
 * vía); sin él, la cookie de sesión de Better Auth (chat web integrado).
 */
export const authenticateMcpRequest: HttpAuthenticator = async (request) => {
  if (bearerToken(request)) return authenticateOAuthBearer(getMcpOAuthProvider(request), request);
  return resolveActorFromRequest(request);
};

/** Handlers de los endpoints OAuth para las rutas de Next. */
export function getMcpOAuthHandlers() {
  return createMcpOAuthHandlers({
    provider: getMcpOAuthProvider,
    // El consentimiento es de un humano: solo la sesión del navegador.
    resolveActor: resolveBrowserActorFromRequest,
    registerLimiter: checkRegisterRateLimit,
  });
}
