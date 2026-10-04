import { addObject } from "@escaperoom/editor/room-doc";
import { WorldObjectSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, ReplaceSchema, RoomIdSchema } from "./define";

/** Fase B — interactuable del escenario (specs/10 §2, specs/08 §2). */
export const addObjectTool = defineTool({
  name: "add_object",
  title: "Añadir objeto",
  description:
    "Añade un objeto interactuable al draft (puerta, cajón, estatua, placa, escondite…) con su tipo, posición, sprite, estados y estado inicial. `object.roomId` es la habitación interna y `position` una celda dentro de su rejilla. En una sala 3D es obligatorio `object.transform` (`x`, `y`, `h` en metros, `yaw` en grados, 0 = mirando al sur); `position` se calcula sola a partir de él, y `sprite` y los estados nombran modelos de `get_model_catalog`.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    object: WorldObjectSchema,
    replace: ReplaceSchema,
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, object, replace, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft({ actor, deps, tool: "add_object", dryRun }, roomId, (doc) =>
      addObject(doc, object, { replace }),
    );
    const { result } = outcome;
    const { transform } = object;
    const where = transform
      ? `(${transform.x}, ${transform.y}, ${transform.h}) ${transform.yaw}°`
      : `(${object.position.x}, ${object.position.y})`;
    return mutationResult(
      outcome,
      `✅ add_object — "${object.id}" ${result.replaced ? "sustituido" : "añadido"} en "${object.roomId}" ${where}`,
      { roomId, id: object.id, replaced: result.replaced },
    );
  },
});
