import {
  IntroMediaError,
  type Actor,
  type IntroMediaErrorCode,
  type IntroMediaService,
} from "@escaperoom/shared/services";
import { handleDomainErrors, NO_STORE, readJson } from "./_http";

/** Dependencias inyectables de los handlers (testeables sin Postgres ni bucket). */
export type IntroMediaHandlerDeps = {
  introMedia: IntroMediaService;
  resolveActor: (request: Request) => Promise<Actor>;
  /** Lee un WebVTT por su URL firmada (servidor a servidor); inyectable en tests. */
  readText?: (url: string, maxBytes: number) => Promise<string | null>;
};

/** `fetch` del WebVTT sin pasar de `maxBytes`; `null` si no se puede leer. */
async function defaultReadText(url: string, maxBytes: number): Promise<string | null> {
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  const text = await response.text();
  return new TextEncoder().encode(text).byteLength > maxBytes ? null : text;
}

export type IntroMediaRouteContext = { params: Promise<{ roomId: string }> };
export type IntroMediaAssetRouteContext = { params: Promise<{ roomId: string; assetId: string }> };

const STATUS_BY_CODE: Record<IntroMediaErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UPLOAD_INCOMPLETE: 409,
  NOT_READY: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_ERROR: 422,
};

const handle = handleDomainErrors(IntroMediaError, STATUS_BY_CODE);

/** Vida de la URL de previsualización del editor. */
const PREVIEW_URL_TTL_SECONDS = 60 * 60;

/** `{ filename, contentType, byteSize }` del cuerpo de `POST …/intro-media/video`. */
function parseVideoUploadBody(body: unknown): {
  filename: string;
  contentType: string;
  byteSize: number;
} {
  const issues: { path: string; message: string }[] = [];
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<
    string,
    unknown
  >;
  if (typeof b.filename !== "string" || !b.filename.trim() || b.filename.length > 200) {
    issues.push({ path: "filename", message: "Obligatorio (máximo 200 caracteres)" });
  }
  if (typeof b.contentType !== "string" || b.contentType.length > 200) {
    issues.push({ path: "contentType", message: "Obligatorio" });
  }
  if (typeof b.byteSize !== "number" || !Number.isFinite(b.byteSize)) {
    issues.push({ path: "byteSize", message: "Debe ser un número" });
  }
  if (issues.length > 0) {
    throw new IntroMediaError("VALIDATION_ERROR", "Datos no válidos", { issues });
  }
  return {
    filename: b.filename as string,
    contentType: b.contentType as string,
    byteSize: b.byteSize as number,
  };
}

/**
 * Cuerpo completo sin pasar de `max` bytes (aunque no venga `Content-Length`,
 * p. ej. con `Transfer-Encoding: chunked`): corta la lectura en cuanto se
 * supera, sin acumular el resto.
 */
async function readBodyCapped(request: Request, max: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new IntroMediaError(
        "PAYLOAD_TOO_LARGE",
        `Los subtítulos superan el máximo de ${Math.floor(max / 1024)} KB`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Handlers REST de los medios de la introducción (encargo lobby-diseño,
 * specs/13). Adaptadores finos sobre `IntroMediaService`: la autorización
 * (solo el autor de la sala), los límites y el sniff viven en el servicio.
 */
export function createIntroMediaHandlers(deps: IntroMediaHandlerDeps) {
  return {
    /**
     * `POST /api/rooms/:roomId/intro-media/video` — `{ filename, contentType,
     * byteSize }` → 201 `{ assetId, uploadUrl, headers }`. El navegador hace
     * `PUT uploadUrl` con el fichero y exactamente esas `headers`, y después
     * llama a `…/video/:assetId/complete`.
     */
    async postVideo(request: Request, ctx: IntroMediaRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.introMedia.authorize(actor);
        const input = parseVideoUploadBody(await readJson(request));
        const ticket = await deps.introMedia.createVideoUpload(actor, roomId, input);
        return Response.json(ticket, { status: 201, headers: NO_STORE });
      });
    },

    /**
     * `POST /api/rooms/:roomId/intro-media/video/:assetId/complete` → 200
     * `{ ref }` (`media:<uuid>`). Comprueba el objeto subido (tamaño y magic
     * bytes); si no cuadra lo borra (415/413) y hay que empezar otra subida.
     */
    async postVideoComplete(request: Request, ctx: IntroMediaAssetRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId, assetId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const result = await deps.introMedia.completeVideoUpload(actor, roomId, assetId);
        return Response.json(result, { headers: NO_STORE });
      });
    },

    /**
     * `POST /api/rooms/:roomId/intro-media/subtitles?lang=xx` — el cuerpo es
     * el `.vtt` tal cual (`Content-Type: text/vtt`) → 201 `{ ref }`.
     */
    async postSubtitles(request: Request, ctx: IntroMediaRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        // Sesión antes que cuerpo: un anónimo recibe 401 sin subir nada.
        deps.introMedia.authorize(actor);
        const lang = new URL(request.url).searchParams.get("lang");
        if (!lang) {
          throw new IntroMediaError("VALIDATION_ERROR", "Falta el idioma (`?lang=`)", {
            issues: [{ path: "lang", message: "Obligatorio" }],
          });
        }
        const max = deps.introMedia.limits.maxSubtitlesBytes;
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (declaredLength > max) {
          throw new IntroMediaError(
            "PAYLOAD_TOO_LARGE",
            `Los subtítulos superan el máximo de ${Math.floor(max / 1024)} KB`,
          );
        }
        const bytes = await readBodyCapped(request, max);
        const result = await deps.introMedia.uploadSubtitles(actor, roomId, { lang, bytes });
        return Response.json(result, { status: 201, headers: NO_STORE });
      });
    },

    /**
     * `GET /api/rooms/:roomId/intro-media/subtitles?ref=…` → el WebVTT tal
     * cual (`text/vtt`), servido desde el MISMO origen: un `<track>` que apunta
     * a la URL firmada del bucket (otro origen) no carga sin CORS en el bucket
     * y `crossorigin` en el `<video>`. Solo el autor (vista previa del editor);
     * en partida los subtítulos viajan ya resueltos (`IntroModel`).
     */
    async getSubtitles(request: Request, ctx: IntroMediaRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.introMedia.authorize(actor);
        const ref = new URL(request.url).searchParams.get("ref");
        if (!ref) {
          throw new IntroMediaError("VALIDATION_ERROR", "Falta la referencia (`?ref=`)", {
            issues: [{ path: "ref", message: "Obligatorio" }],
          });
        }
        const url = await deps.introMedia.previewUrl(actor, roomId, ref, { expiresIn: 60 });
        const readText = deps.readText ?? defaultReadText;
        const vtt = await readText(url, deps.introMedia.limits.maxSubtitlesBytes);
        if (vtt === null || !/^\uFEFF?WEBVTT/u.test(vtt)) {
          throw new IntroMediaError("NOT_FOUND", "Esos subtítulos no están disponibles");
        }
        return new Response(vtt, {
          headers: { ...NO_STORE, "content-type": "text/vtt; charset=utf-8" },
        });
      });
    },

    /**
     * `GET /api/rooms/:roomId/intro-media/url?ref=…` → `{ url }`: URL firmada
     * (1 h) para previsualizar en el editor. Solo el autor de la sala.
     */
    async getUrl(request: Request, ctx: IntroMediaRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.introMedia.authorize(actor);
        const ref = new URL(request.url).searchParams.get("ref");
        if (!ref) {
          throw new IntroMediaError("VALIDATION_ERROR", "Falta la referencia (`?ref=`)", {
            issues: [{ path: "ref", message: "Obligatorio" }],
          });
        }
        const url = await deps.introMedia.previewUrl(actor, roomId, ref, {
          expiresIn: PREVIEW_URL_TTL_SECONDS,
        });
        return Response.json({ url }, { headers: NO_STORE });
      });
    },
  };
}
