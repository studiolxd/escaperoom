import { resolveActorFromRequest } from "@/server/context";
import { createRoomDetailHandler } from "@/server/rest/rooms-list";
import { getCatalogService } from "@/server/services";

export const runtime = "nodejs";

/** GET /api/rooms/:roomId — detalle público de catálogo (specs/13 §3). */
export const GET = createRoomDetailHandler({
  catalog: getCatalogService(),
  resolveActor: resolveActorFromRequest,
});
