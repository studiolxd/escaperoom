import { resolveActorFromRequest } from "@/server/context";
import {
  createAccessKeyCardsHandlers,
  type ExportRouteContext,
} from "@/server/rest/access-key-cards";
import { getAccessKeyCardsService, getExportBlobStore } from "@/server/services";
import { siteUrl } from "@/lib/catalog-seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/exports/:jobId — `{ status, downloadUrl? }` del export asíncrono (organizador). */
export function GET(request: Request, ctx: ExportRouteContext) {
  return createAccessKeyCardsHandlers({
    cards: getAccessKeyCardsService(),
    blobs: getExportBlobStore(),
    resolveActor: resolveActorFromRequest,
    appUrl: siteUrl(),
  }).getExport(request, ctx);
}
