import { listIds, setSubRoomGrid, setTileset } from "@escaperoom/editor/room-doc";
import { GridSchema, ID_PATTERN, TileLayerSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { ToolError } from "../results";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/**
 * Fase A — tileset y, opcionalmente, dimensiones y capas (specs/10 §2). En el
 * RoomPackage cada habitación interna tiene su rejilla y sus capas
 * (`map.rooms[]`), así que `size`/`layers` se aplican a las habitaciones
 * indicadas en `subroomIds` (por defecto, a todas las ya definidas).
 */
export const setMapTool = defineTool({
  name: "set_map",
  title: "Definir mapa",
  description:
    "Define el tileset del mapa del draft y, opcionalmente, las dimensiones (columnas × filas) y capas de tiles (RLE [cantidad, tileId, …]) de sus habitaciones internas: las de `subroomIds` o, si se omite, todas las ya definidas con define_subrooms. Sin `layers` se conservan los tiles que quepan.",
  phase: "structure",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    tileset: z.string().regex(ID_PATTERN),
    size: GridSchema.optional(),
    layers: z.array(TileLayerSchema).optional(),
    subroomIds: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe("Habitaciones a las que aplicar size/layers (por defecto, todas)"),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, tileset, size, layers, subroomIds, dryRun }, { actor, deps }) {
    if (layers && !size) {
      throw new ToolError(
        "INVALID_INPUT",
        "`layers` necesita `size` (el RLE se decodifica sobre esa rejilla)",
      );
    }
    const outcome = await mutateDraft({ actor, deps, tool: "set_map", dryRun }, roomId, (doc) => {
      setTileset(doc, tileset);
      if (!size) return [];
      const targets = subroomIds ?? listIds(doc, "subrooms");
      if (targets.length === 0) {
        throw new ToolError(
          "INVALID_INPUT",
          "no hay habitaciones a las que aplicar size/layers: defínelas primero con define_subrooms (o llama a set_map solo con el tileset)",
        );
      }
      for (const id of targets) setSubRoomGrid(doc, id, size, layers);
      return targets;
    });
    const { result } = outcome;
    const detail =
      result.length > 0 && size
        ? `; ${size.cols}×${size.rows}${layers ? ` con capas [${layers.map((l) => l.name).join(", ")}]` : ""} en [${result.join(", ")}]`
        : "";
    return mutationResult(outcome, `✅ set_map — tileset "${tileset}"${detail}`, {
      roomId,
      tileset,
      subroomIds: result,
    });
  },
});
