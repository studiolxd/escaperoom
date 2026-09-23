import { defineItem } from "@escaperoom/editor/room-doc";
import { ItemDefSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, ReplaceSchema, RoomIdSchema } from "./define";

/** Fase B — entrada del catálogo de objetos de inventario (specs/10 §2). */
export const defineItemTool = defineTool({
  name: "define_item",
  title: "Definir objeto de inventario",
  description:
    "Añade un objeto al catálogo de inventario del draft (llave, vela, cáliz…) con su nombre localizado (en los idiomas de la sala) e icono.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    item: ItemDefSchema,
    replace: ReplaceSchema,
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, item, replace, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft({ actor, deps, tool: "define_item", dryRun }, roomId, (doc) =>
      defineItem(doc, item, { replace }),
    );
    const { result } = outcome;
    return mutationResult(
      outcome,
      `✅ define_item — "${item.id}" ${result.replaced ? "sustituido" : "añadido"} al catálogo`,
      { roomId, id: item.id, replaced: result.replaced },
    );
  },
});
