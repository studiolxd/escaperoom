import { z } from "zod";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/** Fase E — vista filtrada de un puzzle (ahorra tokens, specs/10 §5). */
export const getPuzzleTool = defineTool({
  name: "get_puzzle",
  title: "Ver puzzle",
  description: "Devuelve un puzzle del draft por id (vista filtrada: no carga la sala entera).",
  phase: "query",
  ticket: "4.3",
  inputSchema: z.object({ roomId: RoomIdSchema, puzzleId: z.string().min(1) }),
  annotations: READ_ONLY,
});
