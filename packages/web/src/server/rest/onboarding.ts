import { DEFAULT_TILESET, roomPackageToDoc, writeRoomMeta } from "@escaperoom/editor/room-doc";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { isAnonymous, RoomDraftError, type Actor, type RoomDraftService } from "@escaperoom/shared/services";
import * as Y from "yjs";
import { z } from "zod";
import { errorResponse, handleDomainErrors, NO_STORE, readJson } from "./_http";

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
  INVALID_UPDATE: 422,
  PAYLOAD_TOO_LARGE: 413,
} as const;

const handle = handleDomainErrors(RoomDraftError, STATUS_BY_CODE);

/** `POST /api/onboarding/rooms` (A-9): única ruta del wizard que validaba a mano. */
const CreateRoomBodySchema = z.object({
  template: z.enum(["rey-aldric", "blank"]),
  title: z.string().trim().min(1).max(200).optional(),
});

/**
 * Memo del fixture del Rey Aldric ya validado (A-9): `readReyAldricRoomPackageJson`
 * solo memoiza el JSON crudo; `loadRoomPackage` (parseo + validación Zod
 * completa del RoomPackage) se repetía en cada petición.
 */
let cachedFixture: { json: string; room: RoomPackage } | undefined;

function loadCachedReyAldricFixture(readJson: () => string): RoomPackage {
  const json = readJson();
  if (cachedFixture?.json !== json) {
    cachedFixture = { json, room: loadRoomPackage(JSON.parse(json)) };
  }
  return cachedFixture.room;
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
      return handle(async () => {
        const actor = await deps.resolveActor(request);
        if (isAnonymous(actor)) {
          return errorResponse("UNAUTHORIZED", "Inicia sesión para crear tu primera sala", 401);
        }

        const parsed = CreateRoomBodySchema.safeParse(await readJson(request));
        if (!parsed.success) {
          return errorResponse(
            "VALIDATION_ERROR",
            '"template" debe ser "rey-aldric" o "blank"; "title" (opcional) una cadena no vacía',
            422,
          );
        }
        const { template, title } = parsed.data;

        if (template === "blank") {
          const roomTitle = title || "Mi primera sala";
          const room = await deps.drafts.createDraft(actor, {
            title: roomTitle,
            initialUpdate: (roomId) => blankInitialUpdate(roomId, actor.userId, roomTitle),
          });
          return Response.json({ roomId: room.id, template }, { status: 201, headers: NO_STORE });
        }

        // "rey-aldric": copia editable del fixture, con nueva id/autor/título
        // (specs/20 §3 — "sala de ejemplo" desmontable).
        const fixture = loadCachedReyAldricFixture(deps.readReyAldricRoomPackageJson);
        const roomTitle = title || `${fixture.meta.title} (copia)`;
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
        return Response.json({ roomId: room.id, template }, { status: 201, headers: NO_STORE });
      });
    },
  };
}
