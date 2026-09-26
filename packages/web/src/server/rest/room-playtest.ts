import { docToRoomPackage, type RoomPackageSerializer } from "@escaperoom/editor/validation";
import {
  buildDraftDoc,
  INVALID_DRAFT_ERROR,
  PLAYTEST_DISABLED_ERROR,
  PLAYTEST_UNAVAILABLE_ERROR,
  PLAYTEST_UNPLAYABLE_ERROR,
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
 * Error no cubierto por `RoomDraftErrorCode` (setup de playtest deshabilitado,
 * draft no serializable, o fallo del lanzador). Independiente del transporte:
 * lo traduce a HTTP el adaptador REST, y a `ActionError` la server action
 * (`actions/playtest.ts`).
 */
export class PlaytestCreationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "PlaytestCreationError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * `POST /api/rooms/:roomId/playtest` (specs/09 §3): «Jugar» desde el editor.
 * Solo el autor (mismo permiso que el draft). El `RoomPackage` se serializa
 * **aquí**, desde el doc Yjs persistido — el cliente no envía nada — y se
 * congela en Colyseus: editar el borrador después no cambia la partida. No
 * publica ni toca el catálogo; devuelve el link de prueba compartible.
 * Extraída para que el adaptador REST y la server action (`actions/playtest.ts`)
 * compartan la MISMA orquestación sobre `RoomDraftService`, la serialización
 * del editor y el `PlaytestLauncher`.
 */
export async function runPlaytestCreation(
  deps: Pick<RoomPlaytestHandlerDeps, "drafts" | "serialize" | "launcher">,
  actor: Actor,
  roomId: string,
): Promise<RoomPlaytestResponse> {
  const draft = await deps.drafts.loadDraft(actor, roomId);
  if (!deps.serialize) {
    throw new PlaytestCreationError(
      "NOT_IMPLEMENTED",
      "La serialización del draft a RoomPackage aún no está disponible",
      501,
    );
  }
  if (!deps.launcher) {
    throw new PlaytestCreationError(
      PLAYTEST_DISABLED_ERROR,
      "El playtest no está configurado en este entorno",
      503,
    );
  }
  const converted = docToRoomPackage(buildDraftDoc(draft), deps.serialize);
  if (!converted.ok) {
    throw new PlaytestCreationError(
      INVALID_DRAFT_ERROR,
      "El draft aún no forma un RoomPackage válido",
      422,
      converted.errors,
    );
  }
  try {
    const created = await deps.launcher.create({
      roomPackage: converted.pkg,
      authorId: actor.userId,
      draftRoomId: roomId,
    });
    return {
      roomId,
      playtestId: created.playtestId,
      expiresAt: new Date(created.expiresAt).toISOString(),
      path: playtestPath(created.token),
    };
  } catch (err) {
    if (err instanceof PlaytestLaunchError) {
      throw err.code === "UNPLAYABLE"
        ? new PlaytestCreationError(PLAYTEST_UNPLAYABLE_ERROR, err.message, 422, err.details)
        : new PlaytestCreationError(PLAYTEST_UNAVAILABLE_ERROR, err.message, 502);
    }
    throw err;
  }
}

export function createRoomPlaytestHandlers(deps: RoomPlaytestHandlerDeps) {
  return {
    async postPlaytest(request: Request, ctx: RoomRouteContext): Promise<Response> {
      try {
        const { roomId } = await ctx.params;
        const actor = await deps.resolveActor(request);
        const body = await runPlaytestCreation(deps, actor, roomId);
        return Response.json(body, { status: 201, headers: NO_STORE });
      } catch (err) {
        if (err instanceof RoomDraftError) {
          return errorResponse(err.code, err.message, STATUS_BY_CODE[err.code]);
        }
        if (err instanceof PlaytestCreationError) {
          return errorResponse(
            err.code,
            err.message,
            err.status,
            err.details !== undefined ? { details: err.details } : undefined,
          );
        }
        throw err;
      }
    },
  };
}
