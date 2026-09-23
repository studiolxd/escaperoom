import { addRule, proposeRuleId } from "@escaperoom/editor/room-doc";
import { RuleSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, ReplaceSchema, RoomIdSchema } from "./define";

/** Regla de entrada: `id`, `priority` y `once` opcionales (se proponen / toman el valor por defecto). */
const AddRuleInputSchema = RuleSchema.extend({
  id: RuleSchema.shape.id
    .optional()
    .describe("Id legible de la regla; sin él se propone uno a partir del trigger (r-brasero…)"),
  priority: RuleSchema.shape.priority
    .optional()
    .describe("Prioridad (mayor = antes); por defecto 0"),
  once: RuleSchema.shape.once
    .optional()
    .describe("true = se dispara una sola vez (por defecto); false = repetible"),
});

/**
 * Fase C — regla SI/ENTONCES (specs/10 §2, specs/08 §4) sobre el mapa `rules`
 * del doc, el mismo modelo que el grafo de reglas del editor (3.6).
 */
export const addRuleTool = defineTool({
  name: "add_rule",
  title: "Añadir regla",
  description:
    "Añade una regla SI/ENTONCES al draft: disparador, condiciones y acciones (el mismo vocabulario que el grafo de reglas del editor). Todo objeto, item, puzzle, habitación o diálogo referenciado debe existir. Sin `id`, se propone uno a partir del trigger.",
  phase: "logic",
  ticket: "4.3",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    rule: AddRuleInputSchema,
    replace: ReplaceSchema,
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, rule, replace, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft({ actor, deps, tool: "add_rule", dryRun }, roomId, (doc) => {
      const id = rule.id ?? proposeRuleId(doc, rule.trigger);
      const full = { ...rule, id, priority: rule.priority ?? 0, once: rule.once ?? true };
      return { id, ...addRule(doc, full, { replace }) };
    });
    const { result } = outcome;
    return mutationResult(
      outcome,
      `✅ add_rule — "${result.id}" ${result.replaced ? "sustituida" : "añadida"} (${rule.trigger.type}, ${rule.conditions.length} condición(es), ${rule.actions.length} acción(es))`,
      { roomId, id: result.id, replaced: result.replaced },
    );
  },
});
