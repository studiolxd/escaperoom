import {
  RoomDraftError,
  type Actor,
  type DraftSnapshotMeta,
  type RoomDraftErrorCode,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { errorResponse, handleDomainErrors, NO_STORE } from "./_http";

/** Dependencias inyectables de los handlers del draft (testeables sin Postgres). */
export type RoomDraftHandlerDeps = {
  drafts: RoomDraftService;
  resolveActor: (request: Request) => Promise<Actor>;
};

/** Contexto de ruta dinámica de Next (App Router): `params` es asíncrono. */
export type RoomRouteContext = { params: Promise<{ roomId: string }> };

const STATUS_BY_CODE: Record<RoomDraftErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_UPDATE: 422,
};

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
const handle = handleDomainErrors(RoomDraftError, STATUS_BY_CODE);

function snapshotMetaJson(s: DraftSnapshotMeta) {
  return {
    id: s.id.toString(),
    updatesAppliedThrough: s.updatesAppliedThrough.toString(),
    createdAt: s.createdAt.toISOString(),
    byteSize: s.byteSize,
  };
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * Handlers REST del draft Yjs (specs/09 §2, specs/13 §4). Adaptadores finos
 * sobre `RoomDraftService`; los ids `bigserial` viajan como string y los bytes
 * Yjs como base64 dentro del JSON.
 */
export function createRoomDraftHandlers(deps: RoomDraftHandlerDeps) {
  return {
    /** `GET /api/rooms/:roomId/draft` — último snapshot + updates posteriores. */
    async getDraft(request: Request, ctx: RoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const draft = await deps.drafts.loadDraft(actor, roomId);
        return Response.json(
          {
            roomId: draft.roomId,
            snapshot: draft.snapshot
              ? {
                  id: draft.snapshot.id.toString(),
                  updatesAppliedThrough: draft.snapshot.updatesAppliedThrough.toString(),
                  createdAt: draft.snapshot.createdAt.toISOString(),
                  state: toBase64(draft.snapshot.state),
                }
              : null,
            updates: draft.updates.map((u) => ({
              id: u.id.toString(),
              authorId: u.authorId,
              createdAt: u.createdAt.toISOString(),
              data: toBase64(u.data),
            })),
          },
          { headers: NO_STORE },
        );
      });
    },

    /**
     * `POST /api/rooms/:roomId/update` — append de un update Yjs. El cuerpo es
     * el update binario crudo (`application/octet-stream`).
     */
    async postUpdate(request: Request, ctx: RoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.startsWith("application/octet-stream")) {
          return errorResponse(
            "UNSUPPORTED_MEDIA_TYPE",
            "El update se envía como application/octet-stream",
            415,
          );
        }
        const data = new Uint8Array(await request.arrayBuffer());
        const result = await deps.drafts.appendUpdate(actor, roomId, data);
        return Response.json(
          {
            update: {
              id: result.update.id.toString(),
              createdAt: result.update.createdAt.toISOString(),
            },
            snapshot: result.snapshot ? snapshotMetaJson(result.snapshot) : null,
          },
          { status: 201, headers: NO_STORE },
        );
      });
    },

    /** `GET /api/rooms/:roomId/history` — snapshots disponibles para restaurar. */
    async getHistory(request: Request, ctx: RoomRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const limitParam = new URL(request.url).searchParams.get("limit");
        let limit: number | undefined;
        if (limitParam !== null) {
          // A-24: antes `Number(limitParam)` convertía cualquier valor no numérico
          // en `NaN`, que el servicio acababa tratando como 1 en silencio — un
          // `?limit=abc` no avisaba de que su valor se había ignorado.
          limit = Number(limitParam);
          if (!Number.isInteger(limit) || limit < 1) {
            return errorResponse("VALIDATION_ERROR", "limit debe ser un entero positivo", 422);
          }
        }
        const items = await deps.drafts.listHistory(actor, roomId, limit);
        return Response.json({ items: items.map(snapshotMetaJson), nextCursor: null }, { headers: NO_STORE });
      });
    },
  };
}
