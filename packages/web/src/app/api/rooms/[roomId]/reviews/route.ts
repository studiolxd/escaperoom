import type { CatalogRoomRouteContext } from "@/server/rest/rooms-list";
import { resolveActorFromRequest } from "@/server/context";
import { withRateLimit } from "@/server/rate-limit";
import { createRoomReviewsHandlers } from "@/server/rest/room-reviews";
import { getReviewService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handlers() {
  return createRoomReviewsHandlers({
    reviews: getReviewService(),
    resolveActor: resolveActorFromRequest,
  });
}

/** GET /api/rooms/:roomId/reviews — reseñas públicas paginadas con media y recuento. */
export function GET(request: Request, ctx: CatalogRoomRouteContext) {
  return handlers().getReviews(request, ctx);
}

/** POST /api/rooms/:roomId/reviews — crea o edita la reseña del usuario (comprador/jugador). */
export const POST = withRateLimit(
  "review-write",
  (request: Request, ctx: CatalogRoomRouteContext) => handlers().postReview(request, ctx),
);
