import { renderValidationReport, validateRoomPackage } from "@escaperoom/shared/validator";
import { z } from "zod";
import { readDraftRoomPackage } from "../room-draft-reader";
import { textResult } from "../results";
import { defineTool, READ_ONLY, RoomIdSchema } from "./define";

/**
 * Fase D — corre el validador de 2.9 sobre el draft (specs/10 §2): el mismo que
 * corrige al editor humano corrige al agente.
 */
export const validateTool = defineTool({
  name: "validate",
  title: "Validar sala",
  description:
    "Corre el validador sobre el draft: referencias, huérfanos, callejones sin salida y solvabilidad por nº de jugadores. Devuelve el informe legible (✅/🟡/❌) y el resultado estructurado.",
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
    return textResult(renderValidationReport(report), {
      ok: report.ok,
      checks: report.checks.map(({ id, status, summary, issues }) => ({ id, status, summary, issues })),
    });
  },
});
