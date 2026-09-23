import { validateRoomPackage } from "@escaperoom/shared/validator";
import { z } from "zod";
import { buildPublishChecklist, renderPublishChecklist } from "../publish-checklist";
import { readDraftRoomPackage } from "../room-draft-reader";
import { textResult } from "../results";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/**
 * Fase D — corre el validador de 2.9 sobre el draft (specs/10 §2): el mismo que
 * corrige al editor humano corrige al agente. Devuelve la checklist
 * obligatoria de publicación (4.5): errores, avisos, estimación y si
 * `publish` la aceptaría (ampliación del ticket 4.5).
 */
export const validateTool = defineTool({
  name: "validate",
  title: "Validar sala",
  description:
    "Corre el validador sobre el draft: referencias, huérfanos, callejones sin salida y solvabilidad por nº de jugadores. Devuelve la checklist de publicación (errores ❌ que bloquean, avisos 🟡, estimación de duración, ¿publicable?) y el informe completo.",
  phase: "verification",
  ticket: "4.1",
  inputSchema: z.object({
    roomId: RoomIdSchema,
    playerCounts: z
      .array(z.number().int().positive())
      .min(1)
      .optional()
      .describe("Tamaños de grupo a evaluar (por defecto, todos los de meta.players)"),
  }),
  annotations: READ_ONLY,
  async run({ roomId, playerCounts }, { actor, deps }) {
    const room = await readDraftRoomPackage(deps, actor, roomId);
    const report = validateRoomPackage(room, playerCounts ? { playerCounts } : {});
    return textResult(renderPublishChecklist(report, roomId), {
      ok: report.ok,
      ...buildPublishChecklist(report),
      checks: report.checks.map(({ id, status, summary, issues }) => ({
        id,
        status,
        summary,
        issues,
      })),
    });
  },
});
