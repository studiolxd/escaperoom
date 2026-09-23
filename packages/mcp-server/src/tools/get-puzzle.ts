import { RoomDocError, roomDocToPackage } from "@escaperoom/editor/room-doc";
import { z } from "zod";
import { roomDocErrorToToolError } from "../draft-writer";
import { readDraftDoc, rulesTouching } from "../room-draft-reader";
import { textResult } from "../results";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/**
 * Fase E — vista filtrada de un puzzle (ahorra tokens, specs/10 §5): su
 * definición, sus pistas y las reglas que lo mencionan.
 */
export const getPuzzleTool = defineTool({
  name: "get_puzzle",
  title: "Ver puzzle",
  description:
    "Devuelve un puzzle del draft por id con sus pistas y las reglas que lo referencian (vista filtrada: no carga la sala entera).",
  phase: "query",
  ticket: "4.3",
  inputSchema: z.object({ roomId: RoomIdSchema, puzzleId: z.string().min(1) }),
  annotations: READ_ONLY,
  async run({ roomId, puzzleId }, { actor, deps }) {
    const view = await readDraftDoc(deps, actor, roomId, (doc) => {
      const pkg = roomDocToPackage(doc);
      const puzzle = pkg.puzzles.find((candidate) => candidate.id === puzzleId);
      if (!puzzle) {
        throw roomDocErrorToToolError(
          new RoomDocError("UNKNOWN_PUZZLE", `No existe el puzzle "${puzzleId}"`),
          doc,
        );
      }
      return {
        puzzle,
        hints: pkg.hints.filter((hint) => hint.puzzleId === puzzleId),
        rules: rulesTouching(pkg.rules, "puzzle", puzzleId),
      };
    });
    return textResult(JSON.stringify(view), view);
  },
});
