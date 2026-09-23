import { WorldObjectSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/** Fase B — interactuable del escenario (specs/10 §2, specs/08 §2). */
export const addObjectTool = defineTool({
  name: "add_object",
  title: "Añadir objeto",
  description:
    "Añade un objeto interactuable al draft (puerta, cajón, estatua, placa, escondite…) con su tipo, posición, sprite, estados y estado inicial. `object.roomId` es la habitación interna.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({ roomId: RoomIdSchema, object: WorldObjectSchema }),
  annotations: MUTATION,
});
