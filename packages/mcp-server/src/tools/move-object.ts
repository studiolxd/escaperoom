import { setObjectTransform } from "@escaperoom/editor/room-doc";
import { Transform3DSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/** Fase B — recoloca un objeto de una sala 3D (specs/27 §3.1). */
export const moveObjectTool = defineTool({
  name: "move_object",
  title: "Mover objeto 3D",
  description:
    "Mueve o gira un objeto ya añadido de una sala 3D: `transform` con `x`, `y`, `h` en metros, `yaw` en grados [0, 360) (0 = mirando al sur) y `scale` opcional. Con `subroomId` lo pasa además a otra habitación. `position` se recalcula sola.",
  phase: "content",
  ticket: "7.9",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    objectId: z.string().min(1).describe("Id del objeto (de add_object)"),
    transform: Transform3DSchema,
    subroomId: z.string().min(1).optional().describe("Habitación de destino (si cambia)"),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, objectId, transform, subroomId, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft({ actor, deps, tool: "move_object", dryRun }, roomId, (doc) =>
      setObjectTransform(doc, objectId, transform, subroomId),
    );
    return mutationResult(
      outcome,
      `✅ move_object — "${objectId}" en (${transform.x}, ${transform.y}, ${transform.h}) ${transform.yaw}°`,
      { roomId, id: objectId, transform },
    );
  },
});
