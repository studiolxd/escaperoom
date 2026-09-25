import { docToRoomPackage, type RoomPackageSerializer } from "@escaperoom/editor/validation";
import {
  buildDraftDoc,
  RoomDraftError,
  type Actor,
  type RoomDraftErrorCode,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { playtestPath } from "@/lib/playtest-link";
import { PlaytestLaunchError, type PlaytestLauncher } from "../playtest-launcher";
import { errorResponse, NO_STORE } from "./_http";
import type { RoomRouteContext } from "./room-draft";

/** Dependencias inyectables del handler de playtest (testeables sin Postgres ni Colyseus). */
export type RoomPlaytestHandlerDeps = {
  drafts: RoomDraftService;
  resolveActor: (request: Request) => Promise<Actor>;
  /** Doc Yjs del draft → `RoomPackage` (serialización de 3.1). */
  serialize: RoomPackageSerializer | null;
  /** Cliente de la ruta interna de Colyseus; `null` si el playtest no está configurado. */
  launcher: PlaytestLauncher | null;
};

/** Respuesta de `POST /api/rooms/:roomId/playtest`. */
export type RoomPlaytestResponse = {
  roomId: string;
  playtestId: string;
  /** ISO 8601: a partir de aquí el link no sirve y la room se cierra. */
  expiresAt: string;
  /** Ruta sin locale de la página de juego (`/playtest/{token}`), compartible. */
  path: string;
};

const STATUS_BY_CODE: Record<RoomDraftErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  INVALID_UPDATE: 422,
};

/**
 * `POST /api/rooms/:roomId/playtest` (specs/09 §3): «Jugar» desde el editor.
 * Solo el autor (mismo permiso que el draft). El `RoomPackage` se serializa
 * **aquí**, desde el doc Yjs persistido — el cliente no envía nada — y se
 * congela en Colyseus: editar el borrador después no cambia la partida. No
 * publica ni toca el catálogo; devuelve el link de prueba compartible.
 */
export function createRoomPlaytestHandlers(deps: RoomPlaytestHandlerDeps) {
  return {
    async postPlaytest(request: Request, ctx: RoomRouteContext): Promise<Response> {
      try {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const draft = await deps.drafts.loadDraft(actor, roomId);
        if (!deps.serialize) {
          return errorResponse(
            "NOT_IMPLEMENTED",
            "La serialización del draft a RoomPackage aún no está disponible",
            501,
          );
        }
        if (!deps.launcher) {
          return errorResponse(
            "PLAYTEST_DISABLED",
            "El playtest no está configurado en este entorno",
            503,
          );
        }
        const converted = docToRoomPackage(buildDraftDoc(draft), deps.serialize);
        if (!converted.ok) {
          return errorResponse("INVALID_DRAFT", "El draft aún no forma un RoomPackage válido", 422, {
            details: converted.errors,
          });
        }
        const created = await deps.launcher.create({
          roomPackage: converted.pkg,
          authorId: actor.userId,
          draftRoomId: roomId,
        });
        const body: RoomPlaytestResponse = {
          roomId,
          playtestId: created.playtestId,
          expiresAt: new Date(created.expiresAt).toISOString(),
          path: playtestPath(created.token),
        };
        return Response.json(body, { status: 201, headers: NO_STORE });
      } catch (err) {
        if (err instanceof RoomDraftError) {
          return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code]);
        }
        if (err instanceof PlaytestLaunchError) {
          return err.code === "UNPLAYABLE"
            ? errorResponse("PLAYTEST_UNPLAYABLE", err.message, 422, { details: err.details })
            : errorResponse("PLAYTEST_UNAVAILABLE", err.message, 502);
        }
        throw err;
      }
    },
  };
}
