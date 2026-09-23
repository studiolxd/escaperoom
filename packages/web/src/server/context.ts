import { ANONYMOUS_ACTOR, actorFromSession, type Actor } from "@escaperoom/shared/services";
import { auth } from "@/lib/auth";
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

/** Contexto de tRPC por petición: actor + servicios de dominio compartidos. */
export async function createContext(opts: { req: Request }): Promise<Context> {
  const actor = await resolveActorFromRequest(opts.req);
  return { actor, catalog: getCatalogService(), reviews: getReviewService() };
}
