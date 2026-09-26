import { DEFAULT_TILESET, writeRoomMeta } from "@escaperoom/editor/room-doc";
import { RoomPackageMetaSchema } from "@escaperoom/shared/schemas";
import { RoomDraftError } from "@escaperoom/shared/services";
import * as Y from "yjs";
import { z } from "zod";
import { commandErrorToToolError } from "../draft-writer";
import { textResult, ToolError } from "../results";
import { draftErrorToToolError } from "../room-draft-reader";
import { defineTool, DryRunSchema, MUTATION } from "./define";

const MetaInputSchema = RoomPackageMetaSchema.pick({
  title: true,
  theme: true,
  languages: true,
  defaultLanguage: true,
  difficulty: true,
  players: true,
}).extend({
  description: RoomPackageMetaSchema.shape.description.optional(),
  estimatedMinutes: RoomPackageMetaSchema.shape.estimatedMinutes.optional(),
  /**
   * Límite de partida (ticket duración-salas, specs/04 §6): omitido = 60 min
   * por defecto (como hoy); `null` = sin duración; entero positivo = minutos.
   */
  timeLimitMinutes: RoomPackageMetaSchema.shape.timeLimitMinutes,
});

/** Id provisional para comprobar la metadata antes de dar de alta la sala. */
const PROBE_ROOM_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Update inicial del doc: la metadata (con los mismos valores por defecto que
 * una sala nueva del editor) y el tileset por defecto, sin habitaciones.
 */
function initialUpdate(
  meta: z.output<typeof MetaInputSchema>,
  roomId: string,
  authorId: string,
): Uint8Array {
  const doc = new Y.Doc();
  try {
    doc.transact(() => {
      writeRoomMeta(doc, { ...meta, id: roomId, authorId });
      doc.getMap<unknown>("map").set("tileset", DEFAULT_TILESET);
    });
    return Y.encodeStateAsUpdate(doc);
  } catch (error) {
    throw commandErrorToToolError(error, doc);
  } finally {
    doc.destroy();
  }
}

/** Fase A — crea el draft de una sala nueva (specs/10 §2). */
export const createRoomTool = defineTool({
  name: "create_room",
  title: "Crear sala",
  description:
    "Crea un draft de sala nuevo con su metadata: título, tema, idiomas, dificultad (1–3), nº de jugadores y, opcionalmente, la duración de partida en minutos (`timeLimitMinutes`: por defecto 60, `null` = sin duración, sin tope máximo). Devuelve el id del draft.",
  phase: "structure",
  ticket: "4.2",
  inputSchema: z.object({ meta: MetaInputSchema, dryRun: DryRunSchema }),
  annotations: MUTATION,
  async run({ meta, dryRun }, { actor, deps }) {
    if (meta.players.min < 1 || meta.players.min > meta.players.max) {
      throw new ToolError(
        "INVALID_INPUT",
        `players debe cumplir 1 ≤ min ≤ max (recibido min=${meta.players.min}, max=${meta.players.max})`,
      );
    }
    // Se comprueba la metadata (idiomas) ANTES de dar de alta la sala.
    initialUpdate(meta, PROBE_ROOM_ID, actor.userId);
    if (dryRun) {
      return textResult(
        `🧪 create_room (dry-run) — la metadata de "${meta.title}" es válida.\n🧪 dryRun: true — no se ha creado ningún draft.`,
        { dryRun: true },
      );
    }
    let room;
    try {
      room = await deps.drafts.createDraft(actor, {
        title: meta.title,
        initialUpdate: (roomId) => initialUpdate(meta, roomId, actor.userId),
      });
    } catch (error) {
      if (error instanceof RoomDraftError) throw draftErrorToToolError(error);
      throw error;
    }
    return textResult(
      `✅ create_room — draft creado: ${room.id} ("${meta.title}"). Siguiente paso: set_map y define_subrooms.`,
      { roomId: room.id },
    );
  },
});
