import { updatePiece3D } from "@escaperoom/editor/room-doc";
import { PIECE_ID_PATTERN } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";
import { PieceInputSchema } from "./place-pieces";

/** Fase A — modifica piezas ya colocadas (specs/27 §8.2). */
export const updatePiecesTool = defineTool({
  name: "update_pieces",
  title: "Actualizar piezas 3D",
  description:
    "Mueve, gira, escala o cambia de modelo piezas ya colocadas, en una sola transacción: `updates` (1–500) con el `id` de la pieza (de place_pieces o get_pieces) y los campos a cambiar (`model`, `x`, `y`, `h`, `yaw`, `scale`). Unidades: metros y grados [0, 360), 0 = mirando al sur. Los campos omitidos no cambian.",
  phase: "structure",
  ticket: "7.9",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    updates: z
      .array(
        PieceInputSchema.partial().extend({
          id: z.string().regex(PIECE_ID_PATTERN).describe("Id de la pieza (p-xxxxxxxx)"),
        }),
      )
      .min(1)
      .max(500),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, updates, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft(
      { actor, deps, tool: "update_pieces", dryRun },
      roomId,
      (doc) => {
        for (const { id, ...patch } of updates) {
          const defined = Object.fromEntries(
            Object.entries(patch).filter(([, value]) => value !== undefined),
          );
          updatePiece3D(doc, id, defined);
        }
        return updates.length;
      },
    );
    return mutationResult(outcome, `✅ update_pieces — ${outcome.result} pieza(s) actualizadas`, {
      roomId,
      ids: updates.map((update) => update.id),
    });
  },
});
