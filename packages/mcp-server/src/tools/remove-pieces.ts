import { listIds, listPieces3D, removePieces3D } from "@escaperoom/editor/room-doc";
import { PIECE_ID_PATTERN } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { ToolError } from "../results";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/** Fase A — borra piezas de una sala 3D (specs/27 §8.2). */
export const removePiecesTool = defineTool({
  name: "remove_pieces",
  title: "Borrar piezas 3D",
  description:
    "Borra piezas de una sala 3D. Elige UNA forma: `ids` (1–500 ids de pieza; los que no existen se ignoran) o `subroomId` (borra todas las piezas de esa habitación) con `model` opcional (borra solo las de ese modelo). Los ids salen de place_pieces o get_pieces.",
  phase: "structure",
  ticket: "7.9",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    ids: z.array(z.string().regex(PIECE_ID_PATTERN)).min(1).max(500).optional(),
    subroomId: z.string().min(1).optional().describe("Habitación de la que borrar"),
    model: z.string().min(1).optional().describe("Con `subroomId`: solo las piezas de este modelo"),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, ids, subroomId, model, dryRun }, { actor, deps }) {
    if ((ids === undefined) === (subroomId === undefined) || (ids && model !== undefined)) {
      throw new ToolError(
        "INVALID_INPUT",
        "Elige una sola forma: `ids` (lista) o `subroomId` (con `model` opcional), ni las dos ni ninguna",
      );
    }
    const outcome = await mutateDraft(
      { actor, deps, tool: "remove_pieces", dryRun },
      roomId,
      (doc) => {
        if (ids) return removePieces3D(doc, ids);
        const rooms = listIds(doc, "subrooms");
        if (!rooms.includes(subroomId!)) {
          throw new ToolError(
            "NOT_FOUND",
            `No existe la habitación "${subroomId}". Habitaciones disponibles: [${rooms.join(", ")}]`,
            { reason: "UNKNOWN_ROOM", available: rooms },
          );
        }
        const targets = listPieces3D(doc, subroomId)
          .filter((piece) => model === undefined || piece.model === model)
          .map((piece) => piece.id);
        return removePieces3D(doc, targets);
      },
    );
    return mutationResult(outcome, `✅ remove_pieces — ${outcome.result} pieza(s) borradas`, {
      roomId,
      removed: outcome.result,
    });
  },
});
