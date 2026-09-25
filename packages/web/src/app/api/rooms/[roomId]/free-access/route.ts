import { withRateLimit } from "@/server/rate-limit";
import {
  createFreeRoomAccessHandlers,
  type FreeRoomAccessRouteContext,
} from "@/server/rest/free-room-access";
import { getFreeRoomAccessService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:roomId/free-access — público, sin sesión (punto i de "CTA
 * Jugar", `docs/DEUDA.md`). `{ eligible: false }` si la sala no es realmente
 * gratis; con `eligible: true`, el `gameToken` `kind: "free"` que la
 * `GameRoom` acepta sin `purchase`. Rate-limitada por IP (`free-room-play`):
 * cada emisión corresponde a una `GameRoom` nueva.
 */
export const GET = withRateLimit(
  "free-room-play",
  (request: Request, ctx: FreeRoomAccessRouteContext) =>
    createFreeRoomAccessHandlers({ freeRoomAccess: getFreeRoomAccessService() }).getFreeAccess(
      request,
      ctx,
    ),
);
