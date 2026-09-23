import { resolveActorFromRequest } from "@/server/context";
import { createRedeemHandler } from "@/server/rest/access-keys";
import { getRedeemService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/access-keys/redeem — público (puede no haber cuenta): `{ code,
 * displayName?, sessionId?, groupId? }` → consume un asiento y devuelve
 * `{ sessionId, groupId, colyseusEndpoint, roomName, joinToken, expiresAt, player }`.
 */
export function POST(request: Request) {
  return createRedeemHandler({
    redeem: getRedeemService(),
    resolveActor: resolveActorFromRequest,
  })(request);
}
