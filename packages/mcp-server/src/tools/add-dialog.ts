import { DialogDefSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/** Fase B — texto narrativo localizado (specs/10 §2). */
export const addDialogTool = defineTool({
  name: "add_dialog",
  title: "Añadir diálogo",
  description:
    "Añade un texto narrativo localizado al draft (profecía, pergamino, inscripción…), opcionalmente condicionado.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({ roomId: RoomIdSchema, dialog: DialogDefSchema }),
  annotations: MUTATION,
});
