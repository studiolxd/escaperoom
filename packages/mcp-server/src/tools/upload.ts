import {
  AudioError,
  RoomCoverError,
  type AudioErrorCode,
} from "@escaperoom/shared/services";
import { z } from "zod";
import { textResult, ToolError, type ToolErrorCode } from "../results";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/**
 * Tope del `data` en base64 (D-12): el mayor de los dos límites reales
 * (audio, 10 MB) más la holgura de la codificación base64 (4/3) y un margen
 * para las cabeceras JSON-RPC — así el rechazo por tamaño lo da esta tool con
 * un mensaje accionable, no un `RangeError` al decodificar un payload
 * arbitrariamente grande.
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
  UPLOAD_BLOCKED: "UPLOAD_BLOCKED",
  ALREADY_REVIEWED: "INVALID_INPUT",
  AUDIO_PENDING_MODERATION: "NOT_PUBLISHABLE",
  AUDIO_REJECTED: "NOT_PUBLISHABLE",
};

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
 * duración + pre-filtro de moderación). No hay un tercer tipo de asset
 * "genérico" en el editor: el resto del contenido de una sala usa el pack
 * gráfico (sprites/tiles), no subidas del creador.
 */
export const uploadTool = defineTool({
  name: "upload",
  title: "Subir un asset",
  description:
    "Sube una imagen (portada de sala, kind: cover_image) o un audio (biblioteca del creador, kind: audio) y devuelve la referencia para usarlo en otras tools. El binario va en base64 en `data` (MCP no soporta subida por streaming). Mismo límite de tipo y tamaño que la web: imágenes hasta 5 MB (jpeg/png/webp/gif por sus magic bytes), audio hasta 10 MB (mp3, pendiente de moderación tras subir).",
  phase: "meta",
  ticket: "D-12",
  inputSchema: z.object({
    kind: z
      .enum(["cover_image", "audio"])
      .describe(
        "cover_image = portada de una sala (exige roomId); audio = pista para la biblioteca del creador (exige rightsDeclared: true)",
      ),
    roomId: RoomIdSchema.optional().describe("Obligatorio si kind = cover_image"),
    filename: z.string().min(1).max(200),
    contentType: z
      .string()
      .min(1)
      .describe("MIME declarado; el contenido real se verifica por sus magic bytes"),
    data: z
      .string()
      .min(1)
      .max(MAX_DATA_BASE64_LENGTH)
      .describe("Contenido del fichero en base64"),
    rightsDeclared: z
      .boolean()
      .optional()
      .describe("Obligatorio (true) si kind = audio: declaración de derechos (specs/15 §4)"),
  }),
  annotations: MUTATION,
  async run({ kind, roomId, filename, contentType, data, rightsDeclared }, { actor, deps }) {
    let bytes: Uint8Array;
    try {
      bytes = Buffer.from(data, "base64");
    } catch {
      throw new ToolError("INVALID_INPUT", "`data` no es base64 válido");
    }
    if (bytes.byteLength === 0) {
      throw new ToolError("INVALID_INPUT", "el fichero está vacío");
    }

    if (kind === "cover_image") {
      if (!roomId) throw new ToolError("INVALID_INPUT", "kind: \"cover_image\" exige `roomId`");
      if (!deps.roomCover) {
        throw new ToolError(
          "NOT_AVAILABLE",
          "la subida de portadas no está disponible en este transporte del MCP",
        );
      }
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
    try {
      const asset = await deps.audio.uploadAudio(actor, {
        filename,
        contentType,
        bytes,
        rightsDeclared,
      });
      return textResult(
        `✅ upload — audio "${filename}" subido, pendiente de moderación (id ${asset.id})`,
        { kind, id: asset.id, status: asset.status },
      );
    } catch (error) {
      if (error instanceof AudioError) {
        throw new ToolError(AUDIO_ERROR_TO_TOOL_ERROR[error.code], error.message);
      }
      throw error;
    }
  },
});
