import { addPuzzle } from "@escaperoom/editor/room-doc";
import { PuzzleDefinitionSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft } from "../draft-writer";
import { textResult } from "../results";
import { defineTool, MUTATION, ReplaceSchema, RoomIdSchema } from "./define";

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
  }),
  annotations: MUTATION,
  async run({ roomId, puzzle, replace }, { actor, deps }) {
    const { result } = await mutateDraft({ actor, deps, tool: "add_puzzle" }, roomId, (doc) =>
      addPuzzle(doc, puzzle, { replace }),
    );
    return textResult(
      `✅ add_puzzle — "${puzzle.id}" (${puzzle.type}) ${result.replaced ? "sustituido" : "añadido"} en "${puzzle.roomId}"`,
      { roomId, id: puzzle.id, replaced: result.replaced },
    );
  },
});
