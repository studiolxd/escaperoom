import { GridSchema, MapSchema, TileLayerSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/** Fase A — dimensiones, tileset y capas del mapa (specs/10 §2). */
export const setMapTool = defineTool({
  name: "set_map",
  title: "Definir mapa",
  description:
    "Define el tileset, las dimensiones (columnas × filas) y las capas de tiles del mapa del draft.",
  phase: "structure",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    tileset: MapSchema.shape.tileset,
    size: GridSchema,
    layers: z.array(TileLayerSchema),
  }),
  annotations: MUTATION,
});
