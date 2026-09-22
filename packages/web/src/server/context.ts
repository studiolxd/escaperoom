import { ANONYMOUS_ACTOR, actorFromSession, type Actor } from "@escaperoom/shared/services";
import { auth } from "@/lib/auth";
import { getCatalogService } from "./services";
import type { Context } from "./trpc";

/**
 * Deriva el `actor` de la petición a partir de la sesión de Better Auth. Sin
 * sesión (o si la consulta falla) devuelve el actor invitado/anónimo, de modo
 * que el catálogo público sigue funcionando.
 */
export async function resolveActorFromRequest(request: Request): Promise<Actor> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    return actorFromSession(session);
  } catch {
    return ANONYMOUS_ACTOR;
  }
}

/** Contexto de tRPC por petición: actor + servicio de dominio compartido. */
export async function createContext(opts: { req: Request }): Promise<Context> {
  const actor = await resolveActorFromRequest(opts.req);
  return { actor, catalog: getCatalogService() };
}
