import { addHint, proposeHintId } from "@escaperoom/editor/room-doc";
import { HintDefSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft } from "../draft-writer";
import { textResult } from "../results";
import { defineTool, MUTATION, ReplaceSchema, RoomIdSchema } from "./define";

/** Fase B — pista escalonada con coste (specs/10 §2). */
export const addHintTool = defineTool({
  name: "add_hint",
  title: "Añadir pista",
  description:
    "Añade una pista escalonada a un puzzle del draft: nivel (tier), texto localizado y coste. Sin `id`, se propone `hint-<puzzle>-<tier>`.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    hint: HintDefSchema.extend({ id: HintDefSchema.shape.id.optional() }),
    replace: ReplaceSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, hint, replace }, { actor, deps }) {
    const { result } = await mutateDraft({ actor, deps, tool: "add_hint" }, roomId, (doc) => {
      const id = hint.id ?? proposeHintId(doc, hint.puzzleId, hint.tier);
      return { id, ...addHint(doc, { ...hint, id }, { replace }) };
    });
    return textResult(
      `✅ add_hint — "${result.id}" ${result.replaced ? "sustituida" : "añadida"} al puzzle "${hint.puzzleId}" (tier ${hint.tier}, coste ${hint.cost})`,
      { roomId, id: result.id, replaced: result.replaced },
    );
  },
});
