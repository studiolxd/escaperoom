import { ANONYMOUS_ACTOR, actorFromSession, type Actor } from "@escaperoom/shared/services";
import { auth } from "@/lib/auth";
import { consumeRateLimit, userIdOf } from "./rate-limit";
import { getCatalogService, getReviewService } from "./services";
import type { Context } from "./trpc";

/**
 * Deriva el `actor` de las cabeceras (cookie de sesión de Better Auth). Sin
 * sesión (o si la consulta falla) devuelve el actor invitado/anónimo, de modo
 * que el catálogo público sigue funcionando. Lo usan también las páginas SSR.
 */
export async function resolveActorFromHeaders(headers: Headers): Promise<Actor> {
  try {
    const session = await auth.api.getSession({ headers });
    return actorFromSession(session);
  } catch {
    return ANONYMOUS_ACTOR;
  }
}

/** `actor` de una petición REST/tRPC (ver `resolveActorFromHeaders`). */
export function resolveActorFromRequest(request: Request): Promise<Actor> {
  return resolveActorFromHeaders(request.headers);
}

/**
 * Actor SOLO de la sesión del navegador (cookie de Better Auth), para las
 * acciones que exigen un humano: confirmar una publicación pedida por el MCP
 * (4.5) o consentir un cliente OAuth (4.7). Con cabecera `Authorization`
 * (un token OAuth del MCP, o un token de sesión vía el plugin `bearer` de
 * Better Auth) devuelve el actor anónimo: un agente con su token nunca pasa
 * por humano.
 */
export async function resolveBrowserActorFromHeaders(headers: Headers): Promise<Actor> {
  if (hasAuthorizationHeader(headers)) return ANONYMOUS_ACTOR;
  return resolveActorFromHeaders(headers);
}

/** `actor` de navegador de una petición (ver `resolveBrowserActorFromHeaders`). */
export function resolveBrowserActorFromRequest(request: Request): Promise<Actor> {
  return resolveBrowserActorFromHeaders(request.headers);
}

/** `true` si la petición trae credenciales por cabecera (`Authorization`). */
export function hasAuthorizationHeader(headers: Headers): boolean {
  return headers.has("authorization");
}

/** Contexto de tRPC por petición: actor + servicios de dominio compartidos. */
export async function createContext(opts: { req: Request }): Promise<Context> {
  const actor = await resolveActorFromRequest(opts.req);
  return {
    actor,
    catalog: getCatalogService(),
    reviews: getReviewService(),
    // El actor ya está resuelto: el límite por usuario no vuelve a leer la sesión.
    rateLimit: (policy) =>
      consumeRateLimit(policy, opts.req, { resolveUserId: async () => userIdOf(actor) }),
  };
}
