import { removeCustomModel3D } from "@escaperoom/editor/room-doc";
import { ID_PATTERN } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft, mutationResult } from "../draft-writer";
import { defineTool, DryRunSchema, MUTATION, RoomIdSchema } from "./define";

/** Fase B — quita un modelo propio de una sala 3D (specs/27 §9, encargo 7.8a). */
export const removeModelTool = defineTool({
  name: "remove_model",
  title: "Quitar un modelo 3D propio",
  description:
    "Quita de una sala 3D un modelo propio subido con upload (kind: model3d). Falla con reason REFERENCED_ID si alguna pieza lo usa como `model` o algún objeto como `sprite` o sprite de estado (el error lista los primeros usos: quítalos antes con remove_pieces o add_object/move_object), y con NOT_FOUND si no existe. Los modelos del catálogo del pack no se pueden quitar. El fichero ya subido no se borra del almacenamiento. Los ids salen de get_model_catalog (los marcados como propios).",
  phase: "content",
  ticket: "7.8a",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    modelId: z.string().regex(ID_PATTERN).describe("Id del modelo propio a quitar"),
    dryRun: DryRunSchema,
  }),
  annotations: MUTATION,
  async run({ roomId, modelId, dryRun }, { actor, deps }) {
    const outcome = await mutateDraft(
      { actor, deps, tool: "remove_model", dryRun },
      roomId,
      (doc) => removeCustomModel3D(doc, modelId),
    );
    return mutationResult(outcome, `✅ remove_model — modelo "${modelId}" quitado`, {
      roomId,
      modelId,
    });
  },
});
