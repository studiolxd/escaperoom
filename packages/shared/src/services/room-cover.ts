import { sniffImageMime, UPLOAD_MAX_BYTES, type UploadMime } from "@escaperoom/kit/storage/validation";
import type { Actor } from "./actor";
import { requireUser } from "./common";

/**
 * Portada de sala (A-12/E-17, auditoría 2026-09-24): antes vivía entera en
 * `app/api/rooms/[roomId]/cover-image/route.ts`, el único adaptador del
 * repo con Prisma y storage directos en la `route.ts` — sin test, sin
 * `deletedAt`, sin cuota y con `contentType: file.type` (declarado por quien
 * sube, no verificado) en vez de `sniffImageMime` (magic bytes).
 */

export type RoomCoverErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE";

export class RoomCoverError extends Error {
  code: RoomCoverErrorCode;
  constructor(code: RoomCoverErrorCode, message: string) {
    super(message);
    this.name = "RoomCoverError";
    this.code = code;
  }
}

export type RoomCoverRoomRef = { id: string; authorId: string; coverImageKey: string | null };

/** Puerto de lectura/escritura de la sala (Prisma filtra `deletedAt: null`). */
export interface RoomCoverStore {
  /** `null` si la sala no existe o está borrada (specs/13: nunca se distingue de "no existe"). */
  findRoom(roomId: string): Promise<RoomCoverRoomRef | null>;
  setCoverImageKey(roomId: string, key: string): Promise<void>;
}

/** Puerto de almacenamiento de binarios (el adaptador S3/R2 de `@escaperoom/kit/storage`). */
export interface RoomCoverBlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** URL de lectura firmada y de vida corta (bucket privado). */
  signedReadUrl(key: string): Promise<string>;
}

const EXT_BY_MIME: Record<UploadMime, string | undefined> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": undefined,
  "application/pdf": undefined,
  "text/plain": undefined,
};

export type RoomCoverUpload = { bytes: Uint8Array };

export type RoomCoverService = ReturnType<typeof createRoomCoverService>;

export function createRoomCoverService(deps: { store: RoomCoverStore; blobs: RoomCoverBlobStore }) {
  return {
    /** Comprobar la sesión antes de leer el `multipart` (anónimo -> 401, nunca 422 por falta de `file`). */
    authorize(actor: Actor): void {
      requireUser(actor, RoomCoverError);
    },

    /**
     * `POST /api/rooms/:roomId/cover-image`. El tipo se detecta por los
     * magic bytes del contenido (`sniffImageMime`), nunca por el `Content-Type`
     * declarado por quien sube. Orden de escritura: `putObject` → `update` →
     * `deleteObject(old)` — si el `update` falla, la portada anterior sigue
     * intacta (antes se borraba ANTES de confirmar el `update`, así que un
     * fallo ahí dejaba la sala sin portada).
     */
    async uploadCoverImage(
      actor: Actor,
      roomId: string,
      upload: RoomCoverUpload,
    ): Promise<{ coverImageUrl: string }> {
      requireUser(actor, RoomCoverError);

      const room = await deps.store.findRoom(roomId);
      if (!room) throw new RoomCoverError("NOT_FOUND", "La sala no existe");
      if (room.authorId !== actor.userId) {
        throw new RoomCoverError("FORBIDDEN", "Solo el autor puede cambiar la portada");
      }

      if (upload.bytes.byteLength > UPLOAD_MAX_BYTES) {
        throw new RoomCoverError("PAYLOAD_TOO_LARGE", "Imagen demasiado grande");
      }
      const mime = sniffImageMime(upload.bytes);
      const ext = mime ? EXT_BY_MIME[mime] : undefined;
      if (!mime || !ext) {
        throw new RoomCoverError("UNSUPPORTED_MEDIA_TYPE", "Formato de imagen no admitido");
      }

      const key = `rooms/${roomId}/cover.${ext}`;
      await deps.blobs.put(key, upload.bytes, mime);
      await deps.store.setCoverImageKey(roomId, key);
      if (room.coverImageKey && room.coverImageKey !== key) {
        await deps.blobs.delete(room.coverImageKey).catch(() => undefined);
      }

      const coverImageUrl = await deps.blobs.signedReadUrl(key);
      return { coverImageUrl };
    },
  };
}
