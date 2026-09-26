import { slidingRateLimiter } from "@escaperoom/kit/rate-limit";
import {
  AudioError,
  IntroMediaError,
  RoomCoverError,
  type Actor,
  type AudioErrorCode,
  type IntroMediaErrorCode,
} from "@escaperoom/shared/services";
import { z } from "zod";
import type { UploadQuotaPolicy } from "../deps";
import { textResult, ToolError, type ToolErrorCode } from "../results";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/**
 * Tope del `data` en base64 (D-12): el mayor de los dos límites reales
 * (audio, 10 MB) más la holgura de la codificación base64 (4/3) y un margen
 * para las cabeceras JSON-RPC — así el rechazo por tamaño lo da esta tool con
 * un mensaje accionable, no un `RangeError` al decodificar un payload
 * arbitrariamente grande.
 *
 * El vídeo de la introducción (`intro_video`) admite hasta 200 MB en la web,
 * pero por aquí se queda en este mismo tope de transporte: 200 MB en base64
 * serían ~267 MB de JSON-RPC en una sola llamada (memoria del proceso y del
 * cliente). Los vídeos mayores se suben desde el editor web (PUT presignado
 * directo al bucket) y su `ref` se usa igual en `set_room_intro`.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_DATA_BASE64_LENGTH = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 4096;

const AUDIO_ERROR_TO_TOOL_ERROR: Record<AudioErrorCode, ToolErrorCode> = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "INVALID_INPUT",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  AUDIO_REJECTED: "NOT_PUBLISHABLE",
};

const INTRO_MEDIA_ERROR_TO_TOOL_ERROR: Record<IntroMediaErrorCode, ToolErrorCode> = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "INVALID_INPUT",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UPLOAD_INCOMPLETE: "INVALID_INPUT",
  NOT_READY: "INVALID_INPUT",
};

/**
 * Gasta la cuota de `upload` (revisión de la PR #168): con la MISMA clave que
 * usaría `withRateLimit` en la ruta REST equivalente
 * (`<policyName>:user:<userId>`) sobre el MISMO `slidingRateLimiter`
 * compartido (`@escaperoom/kit/rate-limit`, Redis en producción) — así el
 * cupo es real, no una cuenta paralela. Sin política inyectada (`deps.uploadQuota`
 * sin ese `kind`), no limita: solo el límite genérico de llamadas del MCP (4.7).
 */
async function consumeUploadQuota(
  actor: Actor,
  policy: UploadQuotaPolicy | null | undefined,
): Promise<void> {
  if (!policy) return;
  const key = `${policy.policyName}:user:${actor.userId}`;
  const result = await slidingRateLimiter.hit(key, policy.user.limit, policy.user.windowSeconds);
  if (!result.ok) {
    throw new ToolError(
      "RATE_LIMITED",
      `cuota de subida superada (misma cuota que la web); reintenta en ${result.retryAfter}s`,
      { retryAfter: result.retryAfter },
    );
  }
}

/** Decodifica `data`; nunca antes de que la cuota y la disponibilidad ya se hayan comprobado. */
function decodeBase64(data: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(data, "base64");
  } catch {
    throw new ToolError("INVALID_INPUT", "`data` no es base64 válido");
  }
  if (bytes.byteLength === 0) {
    throw new ToolError("INVALID_INPUT", "el fichero está vacío");
  }
  return bytes;
}

/**
 * Meta-tool `upload` (specs/10 §1.1, ADR-010; D-12 de la auditoría): sube un
 * asset binario para usarlo en la sala. MCP no tiene subida por streaming, así
 * que el binario viaja en base64 dentro de `data` — de ahí el tope de tamaño
 * de arriba, más estricto de lo que necesitaría el fichero decodificado.
 *
 * Reutiliza el MISMO pipeline de subida que ya existe en la web, sin duplicar
 * lógica (ADR-010/022): `RoomCoverService.uploadCoverImage` (portada, A-12,
 * autorización + magic bytes + límite de tamaño) y
 * `AudioAssetService.uploadAudio` (biblioteca del creador, 3.11, tipo real +
 * duración; disponible al instante, sin moderación previa, ADR-039) e
 * `IntroMediaService.uploadVideoBytes`/`uploadSubtitles` (vídeo y WebVTT de la
 * introducción, encargo lobby-diseño: autor de la sala, sniff mp4/webm, WebVTT
 * UTF-8). No hay un tipo de asset "genérico" en el editor: el resto del
 * contenido de una sala usa el pack gráfico (sprites/tiles), no subidas del
 * creador.
 *
 * También reutiliza la CUOTA de esas rutas (revisión de la PR #168): el
 * límite genérico de llamadas del MCP (4.7) es por token y pensado para tools
 * baratas, y por sí solo permitiría subir ficheros de hasta 10 MB al mismo
 * ritmo que cualquier consulta — un atajo para saltarse la cuota de
 * almacenamiento/moderación de la web. `consumeUploadQuota` gasta el MISMO
 * cupo (`deps.uploadQuota`, inyectado porque el MCP no puede importar
 * `RATE_LIMIT_POLICIES` de `packages/web` sin invertir la dependencia).
 */
export const uploadTool = defineTool({
  name: "upload",
  title: "Subir un asset",
  description:
    'Sube una imagen (portada de sala, kind: cover_image), un audio (biblioteca del creador, kind: audio) o un medio de la introducción de la sala (kind: intro_video = vídeo mp4/webm; kind: intro_subtitles = subtítulos WebVTT de un idioma, con `lang`) y devuelve la referencia para usarlo en otras tools (intro_video/intro_subtitles devuelven `ref: "media:<uuid>"` para `set_room_intro`). El binario va en base64 en `data` (MCP no soporta subida por streaming). Mismo límite de tipo, tamaño y cuota que la web: imágenes hasta 5 MB (jpeg/png/webp/gif por sus magic bytes), audio hasta 10 MB (mp3, disponible al instante), subtítulos hasta 512 KB (UTF-8, empiezan por «WEBVTT»); el vídeo, hasta 10 MB por aquí (tope de transporte base64) — los de hasta 200 MB se suben desde el editor web.',
  phase: "meta",
  ticket: "D-12",
  inputSchema: z.object({
    kind: z
      .enum(["cover_image", "audio", "intro_video", "intro_subtitles"])
      .describe(
        "cover_image = portada de una sala (exige roomId); audio = pista para la biblioteca del creador (exige rightsDeclared: true); intro_video = vídeo mp4/webm de la introducción (exige roomId); intro_subtitles = WebVTT de un idioma para ese vídeo (exige roomId y lang)",
      ),
    roomId: RoomIdSchema.optional().describe(
      "Obligatorio si kind = cover_image, intro_video o intro_subtitles",
    ),
    lang: z
      .string()
      .min(1)
      .max(35)
      .optional()
      .describe("Obligatorio si kind = intro_subtitles: idioma declarado de la sala (p. ej. es)"),
    filename: z.string().min(1).max(200),
    contentType: z
      .string()
      .min(1)
      .describe("MIME declarado; el contenido real se verifica por sus magic bytes"),
    data: z.string().min(1).max(MAX_DATA_BASE64_LENGTH).describe("Contenido del fichero en base64"),
    rightsDeclared: z
      .boolean()
      .optional()
      .describe("Obligatorio (true) si kind = audio: declaración de derechos (specs/15 §4)"),
  }),
  annotations: MUTATION,
  async run({ kind, roomId, lang, filename, contentType, data, rightsDeclared }, { actor, deps }) {
    if (kind === "intro_video" || kind === "intro_subtitles") {
      if (!roomId) throw new ToolError("INVALID_INPUT", `kind: "${kind}" exige \`roomId\``);
      if (kind === "intro_subtitles" && !lang) {
        throw new ToolError("INVALID_INPUT", 'kind: "intro_subtitles" exige `lang`');
      }
      if (!deps.introMedia) {
        throw new ToolError(
          "NOT_AVAILABLE",
          "la subida de medios de la introducción no está disponible en este transporte del MCP",
        );
      }
      await consumeUploadQuota(actor, deps.uploadQuota?.introMedia);
      const bytes = decodeBase64(data);
      try {
        const { ref } =
          kind === "intro_video"
            ? await deps.introMedia.uploadVideoBytes(actor, roomId, {
                filename,
                contentType,
                bytes,
              })
            : await deps.introMedia.uploadSubtitles(actor, roomId, { lang: lang!, bytes });
        return textResult(
          kind === "intro_video"
            ? `✅ upload — vídeo de la introducción subido: usa ref "${ref}" en set_room_intro`
            : `✅ upload — subtítulos (${lang}) subidos: usa ref "${ref}" en set_room_intro`,
          { kind, roomId, ref, ...(kind === "intro_subtitles" ? { lang } : {}) },
        );
      } catch (error) {
        if (error instanceof IntroMediaError) {
          throw new ToolError(INTRO_MEDIA_ERROR_TO_TOOL_ERROR[error.code], error.message);
        }
        throw error;
      }
    }

    if (kind === "cover_image") {
      if (!roomId) throw new ToolError("INVALID_INPUT", 'kind: "cover_image" exige `roomId`');
      if (!deps.roomCover) {
        throw new ToolError(
          "NOT_AVAILABLE",
          "la subida de portadas no está disponible en este transporte del MCP",
        );
      }
      await consumeUploadQuota(actor, deps.uploadQuota?.coverImage);
      const bytes = decodeBase64(data);
      try {
        const { coverImageUrl } = await deps.roomCover.uploadCoverImage(actor, roomId, { bytes });
        return textResult(`✅ upload — portada de la sala ${roomId} subida`, {
          kind,
          roomId,
          coverImageUrl,
        });
      } catch (error) {
        if (error instanceof RoomCoverError) throw new ToolError(error.code, error.message);
        throw error;
      }
    }

    if (rightsDeclared !== true) {
      throw new ToolError(
        "INVALID_INPUT",
        'kind: "audio" exige `rightsDeclared: true` (declaración de derechos, specs/15 §4)',
      );
    }
    if (!deps.audio) {
      throw new ToolError(
        "NOT_AVAILABLE",
        "la subida de audio no está disponible en este transporte del MCP",
      );
    }
    await consumeUploadQuota(actor, deps.uploadQuota?.audio);
    const bytes = decodeBase64(data);
    try {
      const asset = await deps.audio.uploadAudio(actor, {
        filename,
        contentType,
        bytes,
        rightsDeclared,
      });
      return textResult(`✅ upload — audio "${filename}" subido y disponible (id ${asset.id})`, {
        kind,
        id: asset.id,
        status: asset.status,
      });
    } catch (error) {
      if (error instanceof AudioError) {
        throw new ToolError(AUDIO_ERROR_TO_TOOL_ERROR[error.code], error.message);
      }
      throw error;
    }
  },
});
