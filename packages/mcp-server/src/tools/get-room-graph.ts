import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import { z } from "zod";
import { readDraftDoc } from "../room-draft-reader";
import { textResult } from "../results";
import { buildRoomGraph } from "../room-graph";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/** Fase C — grafo puzzles/objetos/reglas para que el agente razone (specs/10 §2). */
export const getRoomGraphTool = defineTool({
  name: "get_room_graph",
  title: "Grafo de la sala",
  description:
    "Devuelve el grafo del draft (puzzles, objetos y reglas, con sus dependencias) para razonar sobre la lógica de la sala. Formato compacto: reglas como when/if/then y aristas [origen, relación, destino] con relación requiere | desbloquea | otorga | lleva_a | dispara | condiciona | afecta.",
  phase: "logic",
  ticket: "4.3",
  inputSchema: z.object({ roomId: RoomIdSchema }),
  annotations: READ_ONLY,
  async run({ roomId }, { actor, deps }) {
    const graph = await readDraftDoc(deps, actor, roomId, (doc) =>
      buildRoomGraph(roomDocToPackage(doc)),
    );
    return textResult(JSON.stringify(graph), { graph });
  },
});
