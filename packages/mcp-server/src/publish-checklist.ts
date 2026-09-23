import { renderValidationReport, type ValidationReport } from "@escaperoom/shared/validator";

/**
 * Checklist obligatoria de publicación (ticket 4.5, specs/10 §2 fase D): el
 * informe del validador resumido para el agente — errores ❌ que bloquean,
 * avisos 🟡 que no, y la estimación — con el veredicto «¿publicable?» y el
 * siguiente paso. La usan `validate` y el error de `publish`.
 */
export type PublishChecklist = {
  /** `true` si no hay ❌: `publish` puede pedir la confirmación. */
  publishable: boolean;
  errors: Array<{ check: string; code: string | null; message: string; ids: string[] }>;
  warnings: Array<{ check: string; summary: string; issues: string[] }>;
  estimate: ValidationReport["estimate"];
};

export function buildPublishChecklist(report: ValidationReport): PublishChecklist {
  const errors: PublishChecklist["errors"] = [];
  const warnings: PublishChecklist["warnings"] = [];
  for (const check of report.checks) {
    if (check.status === "error") {
      if (check.issues.length === 0) {
        errors.push({ check: check.id, code: null, message: check.summary, ids: [] });
      }
      for (const issue of check.issues) {
        errors.push({ check: check.id, code: issue.code, message: issue.message, ids: issue.ids });
      }
    } else if (check.status === "warning") {
      warnings.push({
        check: check.id,
        summary: check.summary,
        issues: check.issues.map((issue) => issue.message),
      });
    }
  }
  return { publishable: report.ok, errors, warnings, estimate: report.estimate };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Cabecera de la checklist + informe completo del validador (✅/🟡/❌). */
export function renderPublishChecklist(report: ValidationReport, roomId: string): string {
  const checklist = buildPublishChecklist(report);
  // Los iconos ❌/🟡 solo aparecen si hay algo que señalar (un informe en verde no lleva ❌).
  const counts = `${plural(checklist.errors.length, "error", "errores")} · ${plural(
    checklist.warnings.length,
    "aviso",
    "avisos",
  )}`;
  const verdict = checklist.publishable
    ? `✅ Publicable: llama a publish({ roomId: "${roomId}", versionNotes }) para pedir la confirmación del creador.`
    : "⛔ No publicable: corrige los ❌ y vuelve a llamar a validate.";
  const estimate = checklist.estimate
    ? `Estimación: ~${checklist.estimate.minutes} min (rango ${checklist.estimate.range.min}–${checklist.estimate.range.max}).`
    : "Estimación: no disponible (la sala aún no es solvable).";
  const lines = [`📋 Checklist de publicación — ${counts}`, verdict, estimate];
  if (checklist.errors.length > 0) {
    lines.push("", "Errores que bloquean la publicación:");
    for (const error of checklist.errors) lines.push(`  ❌ [${error.check}] ${error.message}`);
  }
  if (checklist.warnings.length > 0) {
    lines.push("", "Avisos (no bloquean; revísalos con el creador):");
    for (const warning of checklist.warnings) lines.push(`  🟡 ${warning.summary}`);
  }
  lines.push("", "Informe completo del validador:", renderValidationReport(report));
  return lines.join("\n");
}
