import { RoomDocError, roomDocToPackage } from "@escaperoom/editor/room-doc";
import { z } from "zod";
import { roomDocErrorToToolError } from "../draft-writer";
import { readDraftDoc, rulesTouching } from "../room-draft-reader";
import { textResult } from "../results";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/** Fase E — reglas que afectan a un objeto (vista filtrada, specs/10 §5). */
export const getRulesForTool = defineTool({
  name: "get_rules_for",
  title: "Reglas de un objeto",
  description:
    "Devuelve las reglas del draft que disparan con un objeto, lo usan en una condición o actúan sobre él (vista filtrada).",
  phase: "query",
  ticket: "4.3",
  inputSchema: z.object({ roomId: RoomIdSchema, objectId: z.string().min(1) }),
  annotations: READ_ONLY,
  async run({ roomId, objectId }, { actor, deps }) {
    const rules = await readDraftDoc(deps, actor, roomId, (doc) => {
      const pkg = roomDocToPackage(doc);
      if (!pkg.objects.some((object) => object.id === objectId)) {
        throw roomDocErrorToToolError(
          new RoomDocError("UNKNOWN_OBJECT", `No existe el objeto "${objectId}"`),
          doc,
        );
      }
      return rulesTouching(pkg.rules, "object", objectId);
    });
    return textResult(JSON.stringify({ objectId, rules }), { objectId, rules });
  },
});
