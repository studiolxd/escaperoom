import {
  CatalogError,
  type Actor,
  type CatalogErrorCode,
  type CatalogListInput,
  type CatalogService,
} from "@escaperoom/shared/services";

/** Dependencias inyectables de los handlers REST del catálogo (testeables sin base de datos). */
export type RoomsListHandlerDeps = {
  catalog: CatalogService;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type CatalogRoomRouteContext = { params: Promise<{ roomId: string }> };

const STATUS_BY_CODE: Record<CatalogErrorCode, number> = {
  VALIDATION_ERROR: 422,
  ROOM_NOT_FOUND: 404,
};

/**
 * Lectura pública e igual para todos: se deja cachear en el edge un minuto
 * (specs/03: catálogo SSR cacheado en Cloudflare).
 */
const PUBLIC_CACHE = "public, s-maxage=60, stale-while-revalidate=300";

async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof CatalogError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: STATUS_BY_CODE[error.code] },
      );
    }
    throw error;
  }
}

/**
 * Query string → entrada del servicio. `language` y `difficulty` se aceptan
 * repetidos (`?language=es&language=en`) o separados por comas; el resto son
 * valores únicos. La validación vive en el servicio (`parseCatalogQuery`).
 */
export function catalogInputFromSearchParams(params: URLSearchParams): CatalogListInput {
  return {
    language: params.getAll("language"),
    difficulty: params.getAll("difficulty"),
    minPrice: params.get("minPrice"),
    maxPrice: params.get("maxPrice"),
    players: params.get("players"),
    q: params.get("q"),
    sort: params.get("sort"),
    cursor: params.get("cursor"),
    limit: params.get("limit"),
  };
}

/**
 * Handler REST `GET /api/rooms` (specs/13 §3). Adaptador fino: filtros
 * combinables (`language`, `difficulty`, `minPrice`, `maxPrice`, `players`,
 * `q`), `sort` y paginación por cursor `{ items, nextCursor }` (specs/13 §1).
 */
export function createRoomsListHandler(deps: RoomsListHandlerDeps) {
  return async function GET(request: Request): Promise<Response> {
    return handle(async () => {
      const actor = await deps.resolveActor(request);
      const input = catalogInputFromSearchParams(new URL(request.url).searchParams);
      return Response.json(await deps.catalog.listRooms(actor, input), {
        headers: { "Cache-Control": PUBLIC_CACHE },
      });
    });
  };
}

/**
 * Handler REST `GET /api/rooms/:roomId` (specs/13 §3): metadata de la última
 * versión publicada + comercio + rating. Nunca el `package` completo.
 */
export function createRoomDetailHandler(deps: RoomsListHandlerDeps) {
  return async function GET(request: Request, ctx: CatalogRoomRouteContext): Promise<Response> {
    return handle(async () => {
      const { roomId } = await ctx.params;
      const actor = await deps.resolveActor(request);
      return Response.json(await deps.catalog.getRoom(actor, roomId), {
        headers: { "Cache-Control": PUBLIC_CACHE },
      });
    });
  };
}
