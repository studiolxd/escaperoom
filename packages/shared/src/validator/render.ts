import type { ValidationReport, ValidationStatus } from "./types";

const ICON: Record<ValidationStatus, string> = { ok: "✅", warning: "🟡", error: "❌" };

/** Checks que solo aparecen en el texto cuando encuentran algo. */
const SILENT_WHEN_PASSED = new Set(["references", "double_use"]);

/**
 * Renderiza el informe en texto, con el formato del "Informe de validación
 * esperado" de `reference/rey-aldric-notas-diseno.md`: una línea ✅/🟡/❌ por
 * check (con sus hallazgos debajo), la secuencia de solución y la estimación.
 */
export function renderValidationReport(report: ValidationReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    if (check.passed && SILENT_WHEN_PASSED.has(check.id)) continue;
    lines.push(`${ICON[check.status]} ${check.summary}`);
    if (!check.passed) {
      for (const issue of check.issues) lines.push(`   · ${issue.message}`);
    }
  }

  const route = report.criticalRoute;
  if (route) {
    const players = `${route.playerCount} jugador${route.playerCount === 1 ? "" : "es"}`;
    lines.push("", `Secuencia de solución verificada (ruta crítica, ${players})`, "");
    const width = Math.max(...route.steps.map((step) => step.description.length), 0);
    const digits = String(route.steps.length).length;
    for (const step of route.steps) {
      const number = `${String(step.index).padStart(digits)}.`;
      const outcome = step.outcome ? ` → ${step.outcome}` : "";
      lines.push(`${number} ${step.description.padEnd(width)}${outcome}`.trimEnd());
    }
  }

  const estimate = report.estimate;
  if (estimate) {
    lines.push(
      "",
      `Estimación: ~${estimate.minutes} min (rango ${estimate.range.min}–${estimate.range.max}) para ${estimate.playerCount} jugador${estimate.playerCount === 1 ? "" : "es"}, ${estimate.routeSteps} pasos.`,
    );
  }
  return lines.join("\n");
}
