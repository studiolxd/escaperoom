import { isCellInRoom, paintTiles, subRoom } from "@escaperoom/editor/room-doc";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { ToolError } from "../results";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/** Fase A — el "pincel" del agente sobre una capa de tiles (specs/10 §2). */
export const paintTilesTool = defineTool({
  name: "paint_tiles",
  title: "Pintar tiles",
  description:
    "Pinta celdas de una capa de tiles de una habitación interna: cada celda indica su columna, fila y el id de tile del tileset.",
  phase: "structure",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    subroomId: z.string().min(1).describe("Id de la habitación interna (SubRoom) a pintar"),
    layer: z.string().min(1).describe("Nombre de la capa de tiles"),
    cells: z
      .array(
        z.object({
          x: z.number().int().nonnegative(),
          y: z.number().int().nonnegative(),
          tile: z.number().int().describe("Id de tile del tileset (0 = vacío)"),
        }),
      )
      .min(1),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, subroomId, layer, cells, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft(
      { actor, deps, tool: "paint_tiles", dryRun },
      roomId,
      (doc) => {
        const room = subRoom(doc, subroomId);
        const outside = cells.filter((cell) => !isCellInRoom(doc, subroomId, cell));
        if (outside.length > 0) {
          const shown = outside
            .slice(0, 10)
            .map((cell) => `(${cell.x}, ${cell.y})`)
            .join(", ");
          throw new ToolError(
            "INVALID_INPUT",
            `${outside.length} celda(s) fuera de la habitación "${subroomId}" (${String(room.get("cols"))}×${String(room.get("rows"))}): ${shown}${outside.length > 10 ? "…" : ""}`,
            { reason: "OUT_OF_BOUNDS" },
          );
        }
        // El pincel del editor pinta un tile por trazo: se agrupan las celdas por tile.
        const byTile = new Map<number, Array<{ x: number; y: number }>>();
        for (const { x, y, tile } of cells) {
          const group = byTile.get(tile) ?? [];
          group.push({ x, y });
          byTile.set(tile, group);
        }
        let total = 0;
        for (const [tile, group] of byTile) total += paintTiles(doc, subroomId, layer, group, tile);
        return total;
      },
    );
    const { result: changed } = outcome;
    return mutationResult(
      outcome,
      `✅ paint_tiles — ${changed} celda(s) cambiadas en "${subroomId}", capa "${layer}"`,
      { roomId, subroomId, layer, changed },
    );
  },
});
