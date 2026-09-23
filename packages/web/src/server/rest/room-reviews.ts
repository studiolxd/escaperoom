import {
  ReviewError,
  type Actor,
  type ReviewErrorCode,
  type ReviewService,
} from "@escaperoom/shared/services";
import type { CatalogRoomRouteContext } from "./rooms-list";

/** Dependencias inyectables de los handlers de reseñas (testeables sin base de datos). */
export type RoomReviewsHandlerDeps = {
  reviews: ReviewService;
  resolveActor: (request: Request) => Promise<Actor>;
};

const STATUS_BY_CODE: Record<ReviewErrorCode, number> = {
  UNAUTHENTICATED: 401,
  REVIEW_NOT_ALLOWED: 403,
  ROOM_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONTENT_REJECTED: 422,
};

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ReviewError) {
      return errorResponse(error.code, error.message, STATUS_BY_CODE[error.code]);
    }
    throw error;
  }
}

/**
 * Handlers REST de reseñas (specs/13 §3). Adaptadores finos sobre
 * `ReviewService`: elegibilidad, validación y moderación viven en el servicio.
 */
export function createRoomReviewsHandlers(deps: RoomReviewsHandlerDeps) {
  return {
    /** `GET /api/rooms/:roomId/reviews` — público, `{ items, nextCursor, ratingAvg, ratingCount }`. */
    async getReviews(request: Request, ctx: CatalogRoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const params = new URL(request.url).searchParams;
        return Response.json(
          await deps.reviews.listReviews(actor, roomId, {
            cursor: params.get("cursor"),
            limit: params.get("limit"),
          }),
        );
      });
    },

    /**
     * `POST /api/rooms/:roomId/reviews` — `{ rating, text? }`. Crea (201) o
     * actualiza (200) la reseña del usuario: `UNIQUE(userId, roomId)`.
     */
    async postReview(request: Request, ctx: CatalogRoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("VALIDATION_ERROR", "El cuerpo no es JSON válido", 400);
        }
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return errorResponse("VALIDATION_ERROR", "Se esperaba un objeto { rating, text? }", 400);
        }
        const { rating, text } = body as { rating?: unknown; text?: unknown };
        const result = await deps.reviews.upsertReview(actor, roomId, { rating, text });
        return Response.json(result, { status: result.created ? 201 : 200 });
      });
    },
  };
}
