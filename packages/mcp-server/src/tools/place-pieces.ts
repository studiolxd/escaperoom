import { fillPieces3D, placePieces3D } from "@escaperoom/editor/room-doc";
import { ID_PATTERN, Piece3DSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { ToolError } from "../results";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/** Pieza de entrada: la del esquema compartido sin `id` (lo asigna el comando). */
export const PieceInputSchema = Piece3DSchema.omit({ id: true });

const FillSchema = z.object({
  model: z.string().regex(ID_PATTERN),
  from: z.object({ x: z.number().int(), y: z.number().int() }),
  to: z.object({ x: z.number().int(), y: z.number().int() }),
  h: PieceInputSchema.shape.h,
  yaw: PieceInputSchema.shape.yaw.optional(),
});

/** Fase A — piezas de arquitectura de una sala 3D (specs/27 §3, §8.2). */
export const placePiecesTool = defineTool({
  name: "place_pieces",
  title: "Colocar piezas 3D",
  description:
    "Coloca piezas de arquitectura o decoración sin lógica (suelo, muros, columnas, alfombras…) en una habitación de una sala 3D. Elige UNA forma: `pieces` (lista de 1–500 con `model`, `x`, `y`, `h`, `yaw` y `scale` opcional) o `fill` (rectángulo de celdas enteras `from`→`to`, ambas esquinas incluidas, con `model`, `h` y `yaw` opcional). Unidades: `x`, `y` y `h` en metros (la habitación mide `bounds.w × bounds.h` m), `yaw` en grados [0, 360) con 0 = mirando al sur. Con `fill`, las piezas van al centro de cada celda (`x + 0.5`, `y + 0.5`) y no sustituye lo que ya haya. Los `model` salen de get_model_catalog. Devuelve los ids de las piezas; después: set_spawn_points, add_object o get_pieces.",
  phase: "structure",
  ticket: "7.9",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    subroomId: z.string().min(1).describe("Habitación interna (id de define_subrooms)"),
    pieces: z.array(PieceInputSchema).min(1).max(500).optional(),
    fill: FillSchema.optional(),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, subroomId, pieces, fill, dryRun }, { actor, deps }) {
    if ((pieces === undefined) === (fill === undefined)) {
      throw new ToolError(
        "INVALID_INPUT",
        "Elige una sola forma: `pieces` (lista) o `fill` (rectángulo), ni las dos ni ninguna",
      );
    }
    const outcome = await mutateDraft(
      { actor, deps, tool: "place_pieces", dryRun },
      roomId,
      (doc) => (pieces ? placePieces3D(doc, subroomId, pieces) : fillPieces3D(doc, subroomId, fill!)),
    );
    const ids = outcome.result;
    return mutationResult(
      outcome,
      `✅ place_pieces — ${ids.length} pieza(s) en "${subroomId}"`,
      { roomId, subroomId, ids },
    );
  },
});
