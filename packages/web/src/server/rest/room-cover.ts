import {
  RoomCoverError,
  type Actor,
  type RoomCoverErrorCode,
  type RoomCoverService,
} from "@escaperoom/shared/services";
import { errorResponse, handleDomainErrors, NO_STORE } from "./_http";

export type RoomCoverHandlerDeps = {
  roomCover: RoomCoverService;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type RoomCoverRouteContext = { params: Promise<{ roomId: string }> };

const STATUS_BY_CODE: Record<RoomCoverErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
};

const handle = handleDomainErrors(RoomCoverError, STATUS_BY_CODE);

/**
 * `POST /api/rooms/:roomId/cover-image` (A-12/E-17): el autor sube la imagen
 * de portada de su sala (`multipart/form-data`, campo `file`). Toda la
 * lógica de dominio (autorización, `deletedAt`, sniff de magic bytes, orden
 * de escritura) vive en `RoomCoverService` — este adaptador solo lee el
 * `multipart` y traduce el resultado.
 */
export function createRoomCoverHandlers(deps: RoomCoverHandlerDeps) {
  return {
    async postCoverImage(request: Request, ctx: RoomCoverRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.roomCover.authorize(actor);

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return errorResponse("INVALID_JSON", "El cuerpo debe ser multipart/form-data", 400);
        }
        const file = form.get("file");
        if (!(file instanceof File)) {
          return errorResponse("VALIDATION_ERROR", "Falta el campo 'file'", 422);
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const { coverImageUrl } = await deps.roomCover.uploadCoverImage(actor, roomId, { bytes });
        return Response.json({ coverImageUrl }, { headers: NO_STORE });
      });
    },
  };
}
