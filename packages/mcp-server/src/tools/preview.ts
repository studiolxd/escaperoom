import { z } from "zod";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/** Fase D — URL de previsualización en modo playtest (specs/10 §2). */
export const previewTool = defineTool({
  name: "preview",
  title: "Previsualizar",
  description: "Devuelve la URL de previsualización del draft en modo playtest.",
  phase: "verification",
  ticket: "4.5",
  inputSchema: z.object({ roomId: RoomIdSchema }),
  annotations: READ_ONLY,
});
