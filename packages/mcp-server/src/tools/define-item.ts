import { defineItem } from "@escaperoom/editor/room-doc";
import { ItemDefSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft } from "../draft-writer";
import { textResult } from "../results";
import { defineTool, MUTATION, ReplaceSchema, RoomIdSchema } from "./define";

/** Fase B — entrada del catálogo de objetos de inventario (specs/10 §2). */
export const defineItemTool = defineTool({
  name: "define_item",
  title: "Definir objeto de inventario",
  description:
    "Añade un objeto al catálogo de inventario del draft (llave, vela, cáliz…) con su nombre localizado (en los idiomas de la sala) e icono.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({ roomId: RoomIdSchema, item: ItemDefSchema, replace: ReplaceSchema }),
  annotations: MUTATION,
  async run({ roomId, item, replace }, { actor, deps }) {
    const { result } = await mutateDraft({ actor, deps, tool: "define_item" }, roomId, (doc) =>
      defineItem(doc, item, { replace }),
    );
    return textResult(
      `✅ define_item — "${item.id}" ${result.replaced ? "sustituido" : "añadido"} al catálogo`,
      { roomId, id: item.id, replaced: result.replaced },
    );
  },
});
