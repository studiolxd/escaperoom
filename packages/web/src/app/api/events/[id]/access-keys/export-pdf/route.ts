import { resolveActorFromRequest } from "@/server/context";
import { createAccessKeyCardsHandlers } from "@/server/rest/access-key-cards";
import type { EventRouteContext } from "@/server/rest/events";
import { getAccessKeyCardsService, getExportBlobStore } from "@/server/services";
import { siteUrl } from "@/lib/catalog-seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/access-keys/export-pdf — `{ codes?, locale? }` (organizador).
 * Menos de 50 tarjetas: el PDF en la respuesta; si no, 202 `{ jobId }` (specs/13 §9).
 */
export function POST(request: Request, ctx: EventRouteContext) {
  return createAccessKeyCardsHandlers({
    cards: getAccessKeyCardsService(),
    blobs: getExportBlobStore(),
    resolveActor: resolveActorFromRequest,
    appUrl: siteUrl(),
  }).postExportPdf(request, ctx);
}
