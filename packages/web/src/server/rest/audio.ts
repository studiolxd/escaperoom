import {
  AudioError,
  audioAssetRef,
  type Actor,
  type AudioAssetRow,
  type AudioAssetService,
  type AudioErrorCode,
} from "@escaperoom/shared/services";
import type { AudioLibraryTrack } from "@escaperoom/shared/audio";
import { BadJsonError, handleDomainErrors, NO_STORE } from "./_http";

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
  AUDIO_REJECTED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_ERROR: 422,
};

/** Holgura para las cabeceras multipart al pre-filtrar por `Content-Length`. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/** Traduce errores de dominio a la forma de error REST (specs/13 §1). */
const handle = handleDomainErrors(AudioError, STATUS_BY_CODE);

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
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Handlers REST del audio del creador (ticket 3.11, specs/15 §1, specs/17 §1).
 * Adaptadores finos sobre `AudioAssetService`: la validación (tipo real,
 * tamaño, duración) y la propiedad viven en el servicio. Un audio nuevo queda
 * `approved` y disponible al instante (ADR-039); no hay cola de moderación
 * previa.
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

    /** `GET /api/audio/uploads` — subidas propias del creador. */
    async listMyUploads(request: Request): Promise<Response> {
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        const rows = await deps.audio.listMyUploads(actor);
        return Response.json({ items: rows.map(assetJson), nextCursor: null }, { headers: NO_STORE });
      });
    },

    /**
     * `POST /api/audio/uploads` — multipart con `file` (MP3) y
     * `rightsDeclared=true`. Responde 201 con el audio ya `approved`.
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
          throw new BadJsonError("Se esperaba un formulario multipart con el campo `file`");
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

    /** `GET /api/audio/uploads/:id` — metadatos + URL de escucha firmada (solo el dueño). */
    async getUpload(request: Request, ctx: AudioUploadRouteContext): Promise<Response> {
      return handle(async () => {
        const { id } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const { asset, previewUrl } = await deps.audio.getUpload(actor, id);
        return Response.json({ ...assetJson(asset), previewUrl }, { headers: NO_STORE });
      });
    },
  };
}
