import type { Actor, IntroMediaService } from "@escaperoom/shared/services";
import { IntroMediaError } from "@escaperoom/shared/services";
import {
  PREVIEW_URL_TTL_SECONDS,
  handle,
  parseVideoUploadBody,
  type IntroMediaAssetRouteContext,
  type IntroMediaRouteContext,
} from "./intro-media";
import { NO_STORE, readJson } from "./_http";

/** Dependencias inyectables de los handlers (testeables sin Postgres ni bucket). */
export type RoomModelsHandlerDeps = {
  introMedia: IntroMediaService;
  resolveActor: (request: Request) => Promise<Actor>;
};

export type RoomModelsRouteContext = IntroMediaRouteContext;
export type RoomModelsAssetRouteContext = IntroMediaAssetRouteContext;

/**
 * Handlers REST de los modelos 3D de los creadores (encargo 7.8a, specs/13).
 * Adaptadores finos sobre `IntroMediaService` (mismo ciclo que el vídeo de la
 * introducción, `kind: "model"`): la autorización (solo el autor de la sala),
 * los límites y la inspección del GLB viven en el servicio. No registran el
 * modelo en el documento: eso lo hace el cliente con `setCustomModel3D`.
 */
export function createRoomModelsHandlers(deps: RoomModelsHandlerDeps) {
  return {
    /**
     * `POST /api/rooms/:roomId/models` — `{ filename, contentType, byteSize }`
     * → 201 `{ assetId, uploadUrl, headers }`. El navegador hace `PUT
     * uploadUrl` con el GLB y esas `headers`, y luego llama a
     * `…/models/:assetId/complete`.
     */
    async post(request: Request, ctx: RoomModelsRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        deps.introMedia.authorize(actor);
        const input = parseVideoUploadBody(await readJson(request));
        const ticket = await deps.introMedia.createModelUpload(actor, roomId, input);
        return Response.json(ticket, { status: 201, headers: NO_STORE });
      });
    },

    /**
     * `POST /api/rooms/:roomId/models/:assetId/complete` → 200
     * `ModelUploadResult`. Inspecciona el GLB; si no vale lo borra (415/413/422)
     * y hay que empezar otra subida.
     */
    async postComplete(request: Request, ctx: RoomModelsAssetRouteContext): Promise<Response> {
      return handle(async () => {
        const { roomId, assetId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const result = await deps.introMedia.completeModelUpload(actor, roomId, assetId);
        return Response.json(result, { headers: NO_STORE });
      });
    },

    /**
     * `GET /api/rooms/:roomId/models/url?ref=…` → `{ url }`: URL firmada de
     * lectura (1 h) de un `media:` propio y listo, o de una clave publicada.
     */
    async getUrl(request: Request, ctx: RoomModelsRouteContext): Promise<Response> {
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
