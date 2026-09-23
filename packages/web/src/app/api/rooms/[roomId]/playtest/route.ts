import { resolveActorFromRequest } from "@/server/context";
import { getPlaytestLauncher } from "@/server/playtest-launcher";
import type { RoomRouteContext } from "@/server/rest/room-draft";
import { createRoomPlaytestHandlers } from "@/server/rest/room-playtest";
import { getDraftSerializer, getRoomDraftService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:roomId/playtest — «Jugar» desde el editor (specs/09 §3):
 * room temporal de Colyseus con el borrador congelado y link de prueba. Solo
 * el autor.
 */
export function POST(request: Request, ctx: RoomRouteContext) {
  return createRoomPlaytestHandlers({
    drafts: getRoomDraftService(),
    resolveActor: resolveActorFromRequest,
    serialize: getDraftSerializer(),
    launcher: getPlaytestLauncher(),
  }).postPlaytest(request, ctx);
}
