import { CatalogError, type Actor, type CatalogService } from "@escaperoom/shared/services";

/** Dependencias inyectables del handler REST (testeable sin base de datos). */
export type RoomsListHandlerDeps = {
  catalog: CatalogService;
  resolveActor: (request: Request) => Promise<Actor>;
};

/**
 * Handler REST `GET /api/rooms` (specs/13 §3). Adaptador fino: `language` se
 * acepta repetido (`?language=es&language=en`) o separado por comas, y filtra
 * por "la sala incluye este idioma" (specs/08 §2.2).
 */
export function createRoomsListHandler(deps: RoomsListHandlerDeps) {
  return async function GET(request: Request): Promise<Response> {
    const actor = await deps.resolveActor(request);
    const language = new URL(request.url).searchParams.getAll("language");
    try {
      return Response.json(await deps.catalog.listRooms(actor, { language }));
    } catch (error) {
      if (error instanceof CatalogError) {
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: 422 },
        );
      }
      throw error;
    }
  };
}
