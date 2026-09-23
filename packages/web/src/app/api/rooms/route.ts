import { resolveActorFromRequest } from "@/server/context";
import { createRoomsListHandler } from "@/server/rest/rooms-list";
import { getCatalogService } from "@/server/services";

export const runtime = "nodejs";

/**
 * GET /api/rooms — listado público de salas publicadas (specs/13 §3), con el
 * filtro `language`. Mismo servicio de dominio que tRPC (ADR-022).
 */
export const GET = createRoomsListHandler({
  catalog: getCatalogService(),
  resolveActor: resolveActorFromRequest,
});
