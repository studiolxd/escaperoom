import { addDialog } from "@escaperoom/editor/room-doc";
import { DialogDefSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import { mutateDraft } from "../draft-writer";
import { textResult } from "../results";
import { defineTool, MUTATION, ReplaceSchema, RoomIdSchema } from "./define";

/** Fase B — texto narrativo localizado (specs/10 §2). */
export const addDialogTool = defineTool({
  name: "add_dialog",
  title: "Añadir diálogo",
  description:
    "Añade un texto narrativo localizado (en los idiomas de la sala) al draft (profecía, pergamino, inscripción…), opcionalmente condicionado.",
  phase: "content",
  ticket: "4.2",
  inputSchema: z.object({ roomId: RoomIdSchema, dialog: DialogDefSchema, replace: ReplaceSchema }),
  annotations: MUTATION,
  async run({ roomId, dialog, replace }, { actor, deps }) {
    const { result } = await mutateDraft({ actor, deps, tool: "add_dialog" }, roomId, (doc) =>
      addDialog(doc, dialog, { replace }),
    );
    return textResult(
      `✅ add_dialog — "${dialog.id}" ${result.replaced ? "sustituido" : "añadido"}`,
      { roomId, id: dialog.id, replaced: result.replaced },
    );
  },
});
