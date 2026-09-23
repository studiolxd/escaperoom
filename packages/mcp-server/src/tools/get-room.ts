import { z } from "zod";
import { readDraftRoomPackage } from "../room-draft-reader";
import { textResult } from "../results";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/**
 * Fase E — estado completo del draft como `RoomPackage` JSON (specs/10 §2). Lee
 * vía el servicio del draft de 3.2 (misma autorización que la REST del editor).
 */
export const getRoomTool = defineTool({
  name: "get_room",
  title: "Ver sala",
  description:
    "Devuelve el estado completo del draft como RoomPackage JSON. En salas grandes, preferir get_puzzle / get_rules_for.",
  phase: "query",
  ticket: "4.1",
  inputSchema: z.object({ roomId: RoomIdSchema }),
  annotations: READ_ONLY,
  async run({ roomId }, { actor, deps }) {
    const room = await readDraftRoomPackage(deps, actor, roomId);
    return textResult(JSON.stringify(room), { room });
  },
});
