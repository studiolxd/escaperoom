import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import { handleCreatorMcpRequest } from "@escaperoom/mcp-server";
import { siteUrl } from "@/lib/catalog-seo";
import {
  authenticateMcpRequest,
  getMcpOAuthProvider,
  getMcpToolRateLimiter,
} from "@/server/mcp-oauth";
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
 * Identidad (4.7): access token OAuth 2.1 (`Authorization: Bearer`) o, para el
 * chat web, la sesión de Better Auth. Sin credenciales válidas → 401 con
 * `WWW-Authenticate` hacia la metadata del recurso protegido; llamadas a
 * tools limitadas por token. Sus tools llaman a los mismos servicios de
 * dominio que tRPC y REST (ADR-010/022).
 */
function handler(request: Request): Promise<Response> {
  return handleCreatorMcpRequest(request, {
    authenticate: authenticateMcpRequest,
    resourceMetadataUrl: (req) => getMcpOAuthProvider(req).protectedResourceMetadataUrl,
    rateLimiter: getMcpToolRateLimiter(),
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
