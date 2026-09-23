import { DEFAULT_TILESET, roomPackageToDoc, writeRoomMeta } from "@escaperoom/editor/room-doc";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { isAnonymous, RoomDraftError, type Actor, type RoomDraftService } from "@escaperoom/shared/services";
import * as Y from "yjs";

/** Únicos orígenes admitidos del paso 2 del wizard (specs/20 §2). */
export type OnboardingRoomTemplate = "rey-aldric" | "blank";

/** Dependencias inyectables del handler (testeable sin base de datos ni fixture en disco). */
export type OnboardingHandlerDeps = {
  drafts: RoomDraftService;
  resolveActor: (request: Request) => Promise<Actor>;
  /** JSON crudo del fixture del Rey Aldric (specs/08 §8); inyectado para poder testear sin FS. */
  readReyAldricRoomPackageJson: () => string;
};

const STATUS_BY_CODE = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_UPDATE: 400,
  PAYLOAD_TOO_LARGE: 413,
} as const;

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

/** Update inicial de una sala en blanco: metadata mínima y tileset por defecto. */
function blankInitialUpdate(roomId: string, authorId: string, title: string): Uint8Array {
  const doc = new Y.Doc();
  try {
    doc.transact(() => {
      writeRoomMeta(doc, {
        id: roomId,
        authorId,
        title,
        theme: "medieval",
        languages: ["es"],
        defaultLanguage: "es",
        difficulty: 1,
        players: { min: 1, max: 4 },
      });
      doc.getMap<unknown>("map").set("tileset", DEFAULT_TILESET);
    });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * Handlers REST del wizard de onboarding del creador (ticket 6.7, specs/20 §2,
 * §3). Solo el paso 2 ("Pinta tu primera sala") necesita servidor: da de alta
 * el draft de la sala nueva, en blanco o como copia editable del Rey Aldric
 * ("modo sala de ejemplo", specs/20 §3), reutilizando `RoomDraftService`
 * (3.1/3.9) y la serialización del editor (`roomPackageToDoc`).
 */
export function createOnboardingHandlers(deps: OnboardingHandlerDeps) {
  return {
    /** `POST /api/onboarding/rooms` — `{ template: "rey-aldric" | "blank", title? }`. */
    async postCreateRoom(request: Request): Promise<Response> {
      const actor = await deps.resolveActor(request);
      if (isAnonymous(actor)) {
        return errorResponse("UNAUTHORIZED", "Inicia sesión para crear tu primera sala", 401);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("VALIDATION_ERROR", "El cuerpo no es JSON válido", 400);
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return errorResponse("VALIDATION_ERROR", "Se esperaba un objeto { template, title? }", 400);
      }
      const { template, title } = body as { template?: unknown; title?: unknown };
      if (template !== "rey-aldric" && template !== "blank") {
        return errorResponse("VALIDATION_ERROR", '"template" debe ser "rey-aldric" o "blank"', 400);
      }
      if (title !== undefined && (typeof title !== "string" || title.trim().length === 0)) {
        return errorResponse("VALIDATION_ERROR", '"title" debe ser una cadena no vacía', 400);
      }

      try {
        if (template === "blank") {
          const roomTitle = (title as string | undefined)?.trim() || "Mi primera sala";
          const room = await deps.drafts.createDraft(actor, {
            title: roomTitle,
            initialUpdate: (roomId) => blankInitialUpdate(roomId, actor.userId, roomTitle),
          });
          return Response.json({ roomId: room.id, template }, { status: 201 });
        }

        // "rey-aldric": copia editable del fixture, con nueva id/autor/título
        // (specs/20 §3 — "sala de ejemplo" desmontable).
        const fixture = loadRoomPackage(JSON.parse(deps.readReyAldricRoomPackageJson()));
        const roomTitle = (title as string | undefined)?.trim() || `${fixture.meta.title} (copia)`;
        const room = await deps.drafts.createDraft(actor, {
          title: roomTitle,
          initialUpdate: (roomId) => {
            const doc = new Y.Doc();
            try {
              const copy = {
                ...fixture,
                meta: { ...fixture.meta, id: roomId, authorId: actor.userId, title: roomTitle },
              };
              roomPackageToDoc(copy, doc);
              return Y.encodeStateAsUpdate(doc);
            } finally {
              doc.destroy();
            }
          },
        });
        return Response.json({ roomId: room.id, template }, { status: 201 });
      } catch (error) {
        if (error instanceof RoomDraftError) {
          const status = STATUS_BY_CODE[error.code] ?? 400;
          return errorResponse(error.code, error.message, status);
        }
        throw error;
      }
    },
  };
}
