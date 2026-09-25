import {
  AccessKeyCardsError,
  type AccessKeyCardsErrorCode,
  type AccessKeyCardsService,
  type Actor,
  type CardExportBlobStore,
  type ExportStatusView,
} from "@escaperoom/shared/services";
import { errorResponse, handleDomainErrors, NO_STORE, readJson } from "./_http";
import type { EventRouteContext } from "./events";

/** Dependencias inyectables de los handlers del PDF de tarjetas (testeables sin Redis ni bucket). */
export type AccessKeyCardsHandlerDeps = {
  cards: AccessKeyCardsService;
  blobs: Pick<CardExportBlobStore, "get">;
  resolveActor: (request: Request) => Promise<Actor>;
  /** Origen público de la app (URLs de canje del QR y de descarga). */
  appUrl: string;
};

export type ExportRouteContext = { params: Promise<{ jobId: string }> };

const STATUS_BY_CODE: Record<AccessKeyCardsErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  NO_PRINTABLE_KEYS: 422,
  EXPORT_UNAVAILABLE: 503,
  EXPORT_LINK_INVALID: 403,
  EXPORT_LINK_EXPIRED: 410,
};

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
const handle = handleDomainErrors(AccessKeyCardsError, STATUS_BY_CODE);

export function exportStatusJson(view: ExportStatusView) {
  return {
    jobId: view.jobId,
    eventId: view.eventId,
    status: view.status,
    cards: view.cards,
    downloadUrl: view.downloadUrl,
    expiresAt: view.expiresAt?.toISOString() ?? null,
  };
}

function pdfResponse(bytes: Uint8Array, filename: string, extra: Record<string, string> = {}) {
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      ...extra,
    },
  });
}

/**
 * Handlers REST del PDF de tarjetas-clave (specs/13 §9). Adaptadores finos
 * sobre `AccessKeyCardsService`.
 */
export function createAccessKeyCardsHandlers(deps: AccessKeyCardsHandlerDeps) {
  return {
    /**
     * `POST /api/events/:id/access-keys/export-pdf` — `{ codes?, locale? }`.
     * < 50 tarjetas: 200 con el PDF; si no, 202 `{ jobId, status, cards }`.
     */
    async postExportPdf(request: Request, ctx: EventRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.cards.authorize(actor);
        const result = await deps.cards.exportCards(
          actor,
          id,
          await readJson(request, { allowEmpty: true }),
          {
            appUrl: deps.appUrl,
          },
        );
        if (result.kind === "pdf") {
          return pdfResponse(result.bytes, result.filename, {
            "X-Access-Key-Cards": String(result.cards),
          });
        }
        return Response.json(
          { jobId: result.jobId, status: "queued", cards: result.cards },
          {
            status: 202,
            headers: { ...NO_STORE, Location: `/api/exports/${result.jobId}` },
          },
        );
      });
    },

    /** `GET /api/exports/:jobId` — `{ status, downloadUrl? }` (organizador). */
    async getExport(request: Request, ctx: ExportRouteContext): Promise<Response> {
      return handle(async () => {
        const { jobId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const view = await deps.cards.getExport(actor, jobId, { appUrl: deps.appUrl });
        return Response.json(exportStatusJson(view), { headers: NO_STORE });
      });
    },

    /**
     * `GET /api/exports/:jobId/download?expires&signature` — el enlace firmado es
     * el permiso (sin sesión). Manipulado → 403, caducado → 410.
     */
    async getDownload(request: Request, ctx: ExportRouteContext): Promise<Response> {
      return handle(async () => {
        const { jobId } = await ctx.params;
        const params = new URL(request.url).searchParams;
        const key = deps.cards.verifyDownload(
          jobId,
          params.get("expires"),
          params.get("signature"),
        );
        const bytes = await deps.blobs.get(key);
        if (!bytes) return errorResponse("NOT_FOUND", "El PDF ya no está disponible", 404);
        return pdfResponse(bytes, `tarjetas-${jobId.slice(0, 8)}.pdf`);
      });
    },
  };
}
