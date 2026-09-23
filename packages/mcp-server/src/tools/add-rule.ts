import { RuleSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/** Fase C — regla SI/ENTONCES (specs/10 §2, specs/08 §4). */
export const addRuleTool = defineTool({
  name: "add_rule",
  title: "Añadir regla",
  description:
    "Añade una regla SI/ENTONCES al draft: disparador, condiciones y acciones (el mismo vocabulario que el grafo de reglas del editor).",
  phase: "logic",
  ticket: "4.3",
  inputSchema: z.object({ roomId: RoomIdSchema, rule: RuleSchema }),
  annotations: MUTATION,
});
