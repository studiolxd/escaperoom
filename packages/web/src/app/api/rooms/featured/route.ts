import { resolveActorFromRequest } from "@/server/context";
import { createFeaturedRoomHandler } from "@/server/rest/featured-room";
import { getCatalogService } from "@/server/services";

export const runtime = "nodejs";

/**
 * GET /api/rooms/featured — API pública (specs/13). Llama al mismo servicio de
 * dominio que tRPC y MCP (ADR-022).
 */
export const GET = createFeaturedRoomHandler({
  catalog: getCatalogService(),
  resolveActor: resolveActorFromRequest,
});
