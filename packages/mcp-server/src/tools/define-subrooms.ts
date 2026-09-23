import { RectSchema, SubRoomSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/** Fase A — habitaciones internas del mapa (specs/10 §2). */
export const defineSubroomsTool = defineTool({
  name: "define_subrooms",
  title: "Definir habitaciones",
  description:
    "Define las habitaciones internas del mapa (p. ej. Salón, Bodega, Catacumbas) con su id, nombre y límites en celdas.",
  phase: "structure",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    subrooms: z
      .array(
        z.object({
          id: SubRoomSchema.shape.id,
          name: SubRoomSchema.shape.name,
          bounds: RectSchema,
        }),
      )
      .min(1),
  }),
  annotations: MUTATION,
});
