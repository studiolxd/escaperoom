import { logger } from "@escaperoom/kit/logger";
import { actorFromSession, ANONYMOUS_ACTOR, type Actor } from "@escaperoom/shared/services";
import { auth } from "@/lib/auth";
import { consumeRateLimit, userIdOf } from "./rate-limit";
import { getCatalogService, getReviewService } from "./services";
import type { Context } from "./trpc";

/**
 * Deriva el `actor` de las cabeceras (cookie de sesión de Better Auth). Sin
 * sesión, `auth.api.getSession` devuelve `null` (no lanza): el actor
 * invitado/anónimo es la respuesta correcta y esperada. Un fallo de
 * infraestructura (Postgres caído, `BETTER_AUTH_SECRET` mal) SÍ lanza — antes
 * (A-11) se atrapaba igual que "sin sesión" y toda petición volvía anónima
 * (401) en silencio, sin traza. Ahora se registra y se propaga: la ruta
 * responde 500 (o, si es pública y tolera trabajar sin actor, decide su
 * propio `catch`) en vez de mentir sobre la sesión.
 */
export async function resolveActorFromHeaders(headers: Headers): Promise<Actor> {
  let session;
  try {
    session = await auth.api.getSession({ headers });
  } catch (err) {
    logger.error({ err }, "context: fallo resolviendo la sesión (no se trata como anónimo)");
    throw err;
  }
  return actorFromSession(session);
}

/**
 * `actor` de una petición REST/tRPC (ver `resolveActorFromHeaders`), con
 * caché por `Request` (A-10): `withRateLimit` resuelve el actor para la cuota
 * por usuario y el handler lo vuelve a resolver para autorizar — con la
 * misma instancia de `Request` en ambos, esto evita la segunda consulta a
 * Better Auth/Postgres. El `WeakMap` no retiene nada más allá de la vida de
 * la petición (sin referencia a la `Request`, la entrada es recolectable).
 */
const actorByRequest = new WeakMap<Request, Promise<Actor>>();

export function resolveActorFromRequest(request: Request): Promise<Actor> {
  const cached = actorByRequest.get(request);
  if (cached) return cached;
  const promise = resolveActorFromHeaders(request.headers);
  actorByRequest.set(request, promise);
  return promise;
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
