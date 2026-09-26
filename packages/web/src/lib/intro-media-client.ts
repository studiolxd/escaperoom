import { MAX_INTRO_SUBTITLES_BYTES, MAX_INTRO_VIDEO_BYTES } from "@escaperoom/shared/schemas";

/**
 * Cliente del navegador para los medios de la introducción de la sala
 * (encargo lobby-diseño, specs/04 §7): vídeo (subida directa al bucket con
 * PUT presignado, con progreso) y subtítulos WebVTT por idioma. Contrato REST:
 *
 * - `POST /api/rooms/:roomId/intro-media/video` `{filename, contentType, byteSize}`
 *   → `{assetId, uploadUrl, headers}`; el navegador hace `PUT uploadUrl`.
 * - `POST /api/rooms/:roomId/intro-media/video/:assetId/complete` → `{ref}`
 * - `POST /api/rooms/:roomId/intro-media/subtitles?lang=xx` (cuerpo = el .vtt) → `{ref}`
 * - `GET /api/rooms/:roomId/intro-media/url?ref=…` → `{url}`
 *
 * Las comprobaciones de tipo y tamaño de aquí son solo para avisar pronto:
 * el servidor las repite.
 */

export const INTRO_VIDEO_TYPES = ["video/mp4", "video/webm"] as const;

/** Motivo de rechazo de un fichero en cliente (clave de traducción). */
export type IntroFileProblem =
  "videoType" | "videoTooLarge" | "subtitlesType" | "subtitlesTooLarge";

export function checkIntroVideoFile(file: Pick<File, "type" | "size">): IntroFileProblem | null {
  if (!(INTRO_VIDEO_TYPES as readonly string[]).includes(file.type)) return "videoType";
  if (file.size > MAX_INTRO_VIDEO_BYTES) return "videoTooLarge";
  return null;
}

export function checkIntroSubtitlesFile(
  file: Pick<File, "name" | "type" | "size">,
): IntroFileProblem | null {
  if (!file.name.toLowerCase().endsWith(".vtt") && file.type !== "text/vtt") return "subtitlesType";
  if (file.size > MAX_INTRO_SUBTITLES_BYTES) return "subtitlesTooLarge";
  return null;
}

/** Error de una llamada al contrato REST (estado HTTP; `0` = red/abortado). */
export class IntroMediaError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "IntroMediaError";
    this.status = status;
  }
}

function base(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/intro-media`;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } | string };
      const detail = typeof body.error === "string" ? body.error : body.error?.message;
      if (detail) message = detail;
    } catch {
      // Cuerpo no JSON: se queda el estado.
    }
    throw new IntroMediaError(response.status, message);
  }
  return (await response.json()) as T;
}

/** PUT del fichero a la URL presignada con progreso (fetch no informa del progreso de subida). */
export function putWithProgress(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else reject(new IntroMediaError(xhr.status, `PUT ${xhr.status}`));
    };
    xhr.onerror = () => reject(new IntroMediaError(0, "network"));
    xhr.onabort = () => reject(new IntroMediaError(0, "aborted"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/**
 * Sube el vídeo de la introducción: pide la URL presignada, hace el PUT con
 * progreso y confirma la subida. Devuelve la referencia estable (`media:<uuid>`).
 */
export async function uploadIntroVideo(
  roomId: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const start = await json<{
    assetId: string;
    uploadUrl: string;
    headers?: Record<string, string>;
  }>(
    await fetch(`${base(roomId)}/video`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type, byteSize: file.size }),
      signal,
    }),
  );
  await putWithProgress(start.uploadUrl, file, start.headers ?? {}, onProgress, signal);
  const done = await json<{ ref: string }>(
    await fetch(`${base(roomId)}/video/${encodeURIComponent(start.assetId)}/complete`, {
      method: "POST",
      signal,
    }),
  );
  return done.ref;
}

/** Sube los subtítulos WebVTT de un idioma; devuelve su referencia. */
export async function uploadIntroSubtitles(
  roomId: string,
  lang: string,
  file: File,
): Promise<string> {
  const done = await json<{ ref: string }>(
    await fetch(`${base(roomId)}/subtitles?lang=${encodeURIComponent(lang)}`, {
      method: "POST",
      headers: { "content-type": "text/vtt" },
      body: file,
    }),
  );
  return done.ref;
}

/** URL firmada (vida corta) de una referencia de medio, para la vista previa. */
export async function resolveIntroMediaUrl(roomId: string, ref: string): Promise<string> {
  const { url } = await json<{ url: string }>(
    await fetch(`${base(roomId)}/url?ref=${encodeURIComponent(ref)}`, { cache: "no-store" }),
  );
  return url;
}
