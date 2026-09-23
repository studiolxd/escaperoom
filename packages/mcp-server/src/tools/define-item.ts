import { ItemDefSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { defineTool, MUTATION, RoomIdSchema } from "./define";

/** Fase B — entrada del catálogo de objetos de inventario (specs/10 §2). */
export const defineItemTool = defineTool({
  name: "define_item",
  title: "Definir objeto de inventario",
  description:
    "Añade un objeto al catálogo de inventario del draft (llave, vela, cáliz…) con su nombre localizado e icono.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({ roomId: RoomIdSchema, item: ItemDefSchema }),
  annotations: MUTATION,
});
