import { addPuzzle } from "@escaperoom/editor/room-doc";
import { PuzzleDefinitionSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, ReplaceSchema, RoomIdSchema } from "./define";

/** Fase B — puzzle de una plantilla con su config (specs/10 §2, specs/06). */
export const addPuzzleTool = defineTool({
  name: "add_puzzle",
  title: "Añadir puzzle",
  description:
    "Añade un puzzle al draft a partir de una plantilla (hidden_key, code_lock, simultaneous_plates, combine_items, sliding_puzzle, memory, split_clue, pipes) con su configuración. Los esquemas de cada plantilla están en get_template_catalog.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    puzzle: PuzzleDefinitionSchema,
    replace: ReplaceSchema,
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, puzzle, replace, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft({ actor, deps, tool: "add_puzzle", dryRun }, roomId, (doc) =>
      addPuzzle(doc, puzzle, { replace }),
    );
    const { result } = outcome;
    return mutationResult(
      outcome,
      `✅ add_puzzle — "${puzzle.id}" (${puzzle.type}) ${result.replaced ? "sustituido" : "añadido"} en "${puzzle.roomId}"`,
      { roomId, id: puzzle.id, replaced: result.replaced },
    );
  },
});
