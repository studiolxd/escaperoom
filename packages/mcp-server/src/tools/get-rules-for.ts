import { z } from "zod";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/** Fase E — reglas que afectan a un objeto (vista filtrada, specs/10 §5). */
export const getRulesForTool = defineTool({
  name: "get_rules_for",
  title: "Reglas de un objeto",
  description:
    "Devuelve las reglas del draft que disparan con un objeto o actúan sobre él (vista filtrada).",
  phase: "query",
  ticket: "4.3",
  inputSchema: z.object({ roomId: RoomIdSchema, objectId: z.string().min(1) }),
  annotations: READ_ONLY,
});
