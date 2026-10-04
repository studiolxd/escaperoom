import { getModels3DCatalog } from "@escaperoom/shared/packs";
import { z } from "zod";
import { readDraftRoomPackage } from "../room-draft-reader";
import { omittedNote, splitFloorsAndWalls } from "../room-pieces-view";
import { textResult } from "../results";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/**
 * Fase E — estado completo del draft como `RoomPackage` JSON (specs/10 §2). Lee
 * vía el servicio del draft de 3.2 (misma autorización que la REST del editor).
 * En una sala 3D omite por defecto las piezas de suelo y muro (7.11).
 */
export const getRoomTool = defineTool({
  name: "get_room",
  title: "Ver sala",
  description:
    "Devuelve el estado del draft como RoomPackage JSON. En salas grandes, preferir get_puzzle / get_rules_for. " +
    "En una sala 3D omite por defecto las piezas de suelo y muro (cientos de piezas que superarían el tope de respuesta) y lo indica en `omitted` y en una nota; " +
    "pídelas con get_pieces({ roomId, subroomId, category: \"suelo\" | \"muro\" }) o con includeFloorsAndWalls: true.",
  phase: "query",
  ticket: "4.1",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    includeFloorsAndWalls: z
      .boolean()
      .optional()
      .describe(
        "true = incluye también las piezas de suelo y muro; en salas grandes puede superar el tope de respuesta",
      ),
  }),
  annotations: READ_ONLY,
  async run({ roomId, includeFloorsAndWalls }, { actor, deps }) {
    const full = await readDraftRoomPackage(deps, actor, roomId);
    if (includeFloorsAndWalls) return textResult(JSON.stringify(full), { room: full });
    const { room, omitted, omittedTotal } = splitFloorsAndWalls(
      full,
      getModels3DCatalog(full.map.tileset),
    );
    if (omittedTotal === 0) return textResult(JSON.stringify(room), { room });
    return textResult(`${JSON.stringify(room)}\n\n${omittedNote(omitted, omittedTotal)}`, {
      room,
      omitted,
    });
  },
});
