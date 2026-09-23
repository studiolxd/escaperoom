import { PuzzleDefinitionSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/** Fase B — puzzle de una plantilla con su config (specs/10 §2, specs/06). */
export const addPuzzleTool = defineTool({
  name: "add_puzzle",
  title: "Añadir puzzle",
  description:
    "Añade un puzzle al draft a partir de una plantilla (hidden_key, code_lock, simultaneous_plates, combine_items, sliding_puzzle, memory, split_clue, pipes) con su configuración.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({ roomId: RoomIdSchema, puzzle: PuzzleDefinitionSchema }),
  annotations: MUTATION,
});
