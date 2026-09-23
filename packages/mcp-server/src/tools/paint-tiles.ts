import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

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
  }),
  annotations: MUTATION,
});
