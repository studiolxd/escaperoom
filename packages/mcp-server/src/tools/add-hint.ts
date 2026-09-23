import { HintDefSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/** Fase B — pista escalonada con coste (specs/10 §2). */
export const addHintTool = defineTool({
  name: "add_hint",
  title: "Añadir pista",
  description:
    "Añade una pista escalonada a un puzzle del draft: nivel (tier), texto localizado y coste.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({ roomId: RoomIdSchema, hint: HintDefSchema }),
  annotations: MUTATION,
});
