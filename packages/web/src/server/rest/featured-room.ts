import { CatalogError, type Actor, type CatalogService } from "@escaperoom/shared/services";
import { handleDomainErrors } from "./_http";

/** Dependencias inyectables del handler REST (testeable sin base de datos). */
export type FeaturedRoomHandlerDeps = {
  catalog: CatalogService;
  resolveActor: (request: Request) => Promise<Actor>;
};

/** `getFeaturedRoom` no lanza `CatalogError` hoy; se cablea igual (A-22) por si empieza a hacerlo. */
const handle = handleDomainErrors(CatalogError, {});

/**
 * Handler REST `GET /api/rooms/featured`. Adaptador fino sobre el mismo
 * servicio de dominio que usan tRPC y MCP; la derivación del actor se inyecta
 * para poder testear la paridad sin sesión ni Postgres.
 */
export function createFeaturedRoomHandler(deps: FeaturedRoomHandlerDeps) {
  return async function GET(request: Request): Promise<Response> {
    return handle(async () => {
      const actor = await deps.resolveActor(request);
      const room = await deps.catalog.getFeaturedRoom(actor);
      return Response.json(room);
    });
  };
}
