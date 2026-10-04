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
  /** `ROOMS_3D_ENABLED` (modo 3D, specs/27): sin él, `dimension: "3d"` se rechaza. */
  rooms3dEnabled: boolean;
};

/** Entrada no válida del alta de sala (plantilla o formato); la REST la traduce a 422. */
export class OnboardingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingValidationError";
  }
}

const STATUS_BY_CODE = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_UPDATE: 422,
  PAYLOAD_TOO_LARGE: 413,
} as const;

const handle = handleDomainErrors(RoomDraftError, STATUS_BY_CODE);

/**
 * `POST /api/onboarding/rooms` (A-9): única ruta del wizard que validaba a
 * mano. Exportado para que la server action (`actions/onboarding.ts`)
 * valide con el MISMO esquema, sin repetir los límites a mano.
 */
export const CreateRoomBodySchema = z.object({
  template: z.enum(["rey-aldric", "blank"]),
  title: z.string().trim().min(1).max(200).optional(),
  dimension: z.enum(["2d", "3d"]).optional(),
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
function blankInitialUpdate(
  roomId: string,
  authorId: string,
  title: string,
  dimension: "2d" | "3d",
): Uint8Array {
  const doc = new Y.Doc();
  try {
    doc.transact(() => {
      writeRoomMeta(doc, {
        id: roomId,
        authorId,
        title,
        dimension,
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

export type CreateOnboardingRoomInput = z.infer<typeof CreateRoomBodySchema>;
export type CreateOnboardingRoomResult = { roomId: string; template: OnboardingRoomTemplate };

/**
 * Da de alta el draft de la primera sala del creador (ticket 6.7, specs/20
 * §2, §3), en blanco o como copia editable del Rey Aldric ("modo sala de
 * ejemplo"). Extraído para que el adaptador REST y la server action
 * (`actions/onboarding.ts`) compartan la MISMA orquestación sobre
 * `RoomDraftService` (3.1/3.9) y la serialización del editor
 * (`roomPackageToDoc`) — cada uno resuelve su propio `actor` y valida el
 * cuerpo antes de llamar aquí.
 */
export async function createOnboardingRoom(
  deps: Pick<
    OnboardingHandlerDeps,
    "drafts" | "readReyAldricRoomPackageJson" | "rooms3dEnabled"
  >,
  actor: Actor,
  input: CreateOnboardingRoomInput,
): Promise<CreateOnboardingRoomResult> {
  const { template, title } = input;
  const dimension = input.dimension ?? "2d";

  if (dimension === "3d") {
    if (!deps.rooms3dEnabled) {
      throw new OnboardingValidationError("El modo 3D no está disponible");
    }
    if (template === "rey-aldric") {
      throw new OnboardingValidationError("La plantilla del Rey Aldric solo existe en 2D");
    }
  }

  if (template === "blank") {
    const roomTitle = title || "Mi primera sala";
    const room = await deps.drafts.createDraft(actor, {
      title: roomTitle,
      dimension,
      initialUpdate: (roomId) => blankInitialUpdate(roomId, actor.userId, roomTitle, dimension),
    });
    return { roomId: room.id, template };
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
  return { roomId: room.id, template };
}

/**
 * Handlers REST del wizard de onboarding del creador (ticket 6.7, specs/20 §2,
 * §3). Solo el paso 2 ("Pinta tu primera sala") necesita servidor.
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
            '"template" debe ser "rey-aldric" o "blank"; "title" (opcional) una cadena no vacía; "dimension" (opcional) "2d" o "3d"',
            422,
          );
        }

        try {
          const result = await createOnboardingRoom(deps, actor, parsed.data);
          return Response.json(result, { status: 201, headers: NO_STORE });
        } catch (err) {
          if (err instanceof OnboardingValidationError) {
            return errorResponse("VALIDATION_ERROR", err.message, 422);
          }
          throw err;
        }
      });
    },
  };
}
