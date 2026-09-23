import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/** Fase D — congela una versión publicada (specs/10 §2, §5). */
export const publishTool = defineTool({
  name: "publish",
  title: "Publicar",
  description:
    "Congela y publica una versión del draft. Irreversible: exige el validador en verde y confirmación humana explícita.",
  phase: "verification",
  ticket: "4.5",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    versionNotes: z.string().min(1).describe("Notas de la versión (p. ej. \"v1.0 — sala inicial\")"),
  }),
  annotations: MUTATION,
});
