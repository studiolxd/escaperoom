import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import { handleCreatorMcpRequest } from "@escaperoom/mcp-server";
import { resolveActorFromRequest } from "@/server/context";
import { getCatalogService, getRoomDraftService } from "@/server/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP del creador en `/mcp/creator` (HTTP streamable, sin estado — ticket 4.1).
 * La identidad es la sesión de Better Auth (sin sesión → 401); el OAuth 2.1 de
 * 4.7 se engancha en `authenticate`. Sus tools llaman a los mismos servicios de
 * dominio que tRPC y REST (ADR-010/022).
 */
function handler(request: Request): Promise<Response> {
  return handleCreatorMcpRequest(request, {
    authenticate: resolveActorFromRequest,
    createDeps: () => ({
      catalog: getCatalogService(),
      drafts: getRoomDraftService(),
      roomDocToPackage,
    }),
  });
}

export { handler as GET, handler as POST, handler as DELETE };
