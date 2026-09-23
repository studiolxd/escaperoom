import { addObject } from "@escaperoom/editor/room-doc";
import { WorldObjectSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft } from "../draft-writer";
import { textResult } from "../results";
import { defineTool, MUTATION, ReplaceSchema, RoomIdSchema } from "./define";

/** Fase B — interactuable del escenario (specs/10 §2, specs/08 §2). */
export const addObjectTool = defineTool({
  name: "add_object",
  title: "Añadir objeto",
  description:
    "Añade un objeto interactuable al draft (puerta, cajón, estatua, placa, escondite…) con su tipo, posición, sprite, estados y estado inicial. `object.roomId` es la habitación interna y `position` una celda dentro de su rejilla.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    object: WorldObjectSchema,
    replace: ReplaceSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, object, replace }, { actor, deps }) {
    const { result } = await mutateDraft({ actor, deps, tool: "add_object" }, roomId, (doc) =>
      addObject(doc, object, { replace }),
    );
    return textResult(
      `✅ add_object — "${object.id}" ${result.replaced ? "sustituido" : "añadido"} en "${object.roomId}" (${object.position.x}, ${object.position.y})`,
      { roomId, id: object.id, replaced: result.replaced },
    );
  },
});
