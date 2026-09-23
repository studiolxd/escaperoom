import {
  AudioError,
  audioAssetRef,
  type Actor,
  type AudioAssetRow,
  type AudioAssetService,
  type AudioErrorCode,
} from "@escaperoom/shared/services";
import type { AudioLibraryTrack } from "@escaperoom/shared/audio";

/** Dependencias inyectables de los handlers de audio (testeables sin Postgres ni R2). */
export type AudioHandlerDeps = {
  audio: AudioAssetService;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type AudioUploadRouteContext = { params: Promise<{ id: string }> };

const STATUS_BY_CODE: Record<AudioErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ALREADY_REVIEWED: 409,
  AUDIO_PENDING_MODERATION: 409,
  AUDIO_REJECTED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_ERROR: 422,
  UPLOAD_BLOCKED: 422,
};

/** Holgura para las cabeceras multipart al pre-filtrar por `Content-Length`. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(code: string, message: string, status: number, extra = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: NO_STORE });
}

class BadRequestError extends Error {}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequestError("El cuerpo no es JSON válido");
  }
}

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AudioError) {
      const extra = {
        ...(err.issues.length > 0 ? { issues: err.issues } : {}),
        ...(err.rejectionReason ? { rejectionReason: err.rejectionReason } : {}),
      };
      return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code], extra);
    }
    if (err instanceof BadRequestError) return errorResponse("BAD_REQUEST", err.message, 400);
    throw err;
  }
}

function trackJson(t: AudioLibraryTrack) {
  return { ...t, ref: `library:${t.id}` };
}

function assetJson(a: AudioAssetRow) {
  return {
    id: a.id,
    ref: audioAssetRef(a),
    originalFilename: a.originalFilename,
    contentType: a.contentType,
    byteSize: a.byteSize,
    durationMs: a.durationMs,
    status: a.status,
    rejectionReason: a.rejectionReason,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Vista del moderador: añade dueño, señales del pre-filtro y revisor. */
function moderationJson(a: AudioAssetRow) {
  return {
    ...assetJson(a),
    ownerId: a.ownerId,
    organizationId: a.organizationId,
    moderationFlags: a.moderationFlags,
    reviewedBy: a.reviewedBy,
  };
}

/**
 * Handlers REST del audio del creador (ticket 3.11, specs/15 §1, specs/17 §1).
 * Adaptadores finos sobre `AudioAssetService`: la validación (tipo real,
 * tamaño, duración), la propiedad y la moderación viven en el servicio.
 */
export function createAudioHandlers(deps: AudioHandlerDeps) {
  return {
    /** `GET /api/audio/library?kind=music|sfx|voice` — biblioteca incluida. */
    async listLibrary(request: Request): Promise<Response> {
      return handle(async () => {
        const kind = new URL(request.url).searchParams.get("kind");
        const items = deps.audio.listLibrary(kind === null ? {} : { kind });
        return Response.json({ items: items.map(trackJson) });
      });
    },

    /** `GET /api/audio/uploads` — subidas propias con su estado de moderación. */
    async listMyUploads(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const rows = await deps.audio.listMyUploads(actor);
        return Response.json({ items: rows.map(assetJson), nextCursor: null }, { headers: NO_STORE });
      });
    },

    /**
     * `POST /api/audio/uploads` — multipart con `file` (MP3) y
     * `rightsDeclared=true`. Responde 201 con el audio en `pending`.
     */
    async upload(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        // Sesión antes que cuerpo: un anónimo recibe 401 sin subir nada.
        deps.audio.authorizeUpload(actor);
        const { maxBytes } = deps.audio.limits;
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (declaredLength > maxBytes + MULTIPART_OVERHEAD_BYTES) {
          throw new AudioError(
            "PAYLOAD_TOO_LARGE",
            `El fichero supera el máximo de ${Math.round(maxBytes / (1024 * 1024))} MB`,
          );
        }
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          throw new BadRequestError("Se esperaba un formulario multipart con el campo `file`");
        }
        const file = form.get("file");
        if (!(file instanceof Blob)) {
          throw new AudioError("VALIDATION_ERROR", "Falta el fichero", {
            issues: [{ path: "file", message: "Obligatorio" }],
          });
        }
        const asset = await deps.audio.uploadAudio(actor, {
          filename: file instanceof File ? file.name : "audio.mp3",
          contentType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
          rightsDeclared: form.get("rightsDeclared") === "true",
        });
        return Response.json(assetJson(asset), { status: 201, headers: NO_STORE });
      });
    },

    /** `GET /api/audio/uploads/:id` — metadatos + URL de escucha firmada (dueño o moderador). */
    async getUpload(request: Request, ctx: AudioUploadRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const { asset, previewUrl } = await deps.audio.getUpload(actor, id);
        return Response.json({ ...assetJson(asset), previewUrl }, { headers: NO_STORE });
      });
    },

    /** `GET /api/admin/audio?status=pending&limit=50` — cola de moderación. */
    async listModerationQueue(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const params = new URL(request.url).searchParams;
        const query = Object.fromEntries(
          ["status", "limit"].flatMap((k) => {
            const v = params.get(k);
            return v === null ? [] : [[k, v]];
          }),
        );
        const rows = await deps.audio.listModerationQueue(actor, query);
        return Response.json(
          { items: rows.map(moderationJson), nextCursor: null },
          { headers: NO_STORE },
        );
      });
    },

    /** `PATCH /api/admin/audio/:id` — `{ decision: "approved" | "rejected", reason? }`. */
    async review(request: Request, ctx: AudioUploadRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        await deps.audio.authorizeModeration(actor);
        const asset = await deps.audio.reviewUpload(actor, id, await readJson(request));
        return Response.json(moderationJson(asset), { headers: NO_STORE });
      });
    },
  };
}
