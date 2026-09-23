import { z } from "zod";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/** Fase C — grafo puzzles/objetos/reglas para que el agente razone (specs/10 §2). */
export const getRoomGraphTool = defineTool({
  name: "get_room_graph",
  title: "Grafo de la sala",
  description:
    "Devuelve el grafo del draft (puzzles, objetos y reglas, con sus dependencias) para razonar sobre la lógica de la sala.",
  phase: "logic",
  ticket: "4.3",
  inputSchema: z.object({ roomId: RoomIdSchema }),
  annotations: READ_ONLY,
});
