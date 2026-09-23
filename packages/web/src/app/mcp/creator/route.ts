import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import { handleCreatorMcpRequest } from "@escaperoom/mcp-server";
import { siteUrl } from "@/lib/catalog-seo";
import { resolveActorFromRequest } from "@/server/context";
import { getPlaytestLauncher } from "@/server/playtest-launcher";
import {
  getCatalogService,
  getPublishConfirmationService,
  getRoomDraftService,
} from "@/server/services";

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
      // 4.5: `preview` (playtest de 3.8) y `publish` (solicitud que el creador
      // confirma en /publish-confirm con su sesión).
      appUrl: siteUrl(),
      playtests: getPlaytestLauncher(),
      publishRequests: getPublishConfirmationService(),
    }),
  });
}

export { handler as GET, handler as POST, handler as DELETE };
