import type { ValidationCheckId, ValidationReport } from "./types";

/**
 * Modo incremental del validador (ticket 4.4, specs/10 §3): compara el informe
 * de un draft ANTES y DESPUÉS de una mutación para saber qué hallazgos
 * introduce, cuáles ya estaban y cuáles resuelve. Es puro y solo lee los
 * informes de `validateRoomPackage`, así que su API no cambia.
 *
 * Criterio ("¿empeora el draft?"):
 *
 * - Cada issue de un check ❌/🟡 es un hallazgo con una huella estable
 *   `check|code|ids ordenados` (sin el texto: los mensajes citan listas de
 *   disponibles que cambian con cualquier alta). Se comparan como multiconjunto:
 *   si la misma huella aparece más veces después que antes, las de más son
 *   nuevas.
 * - `solvability/unsolvable` es el estado natural de un draft a medio construir
 *   (hasta que existe la regla de victoria, lo que bloquea cambia con cada alta).
 *   Por eso no se compara por huella: solo es nuevo si un tamaño de grupo que
 *   ERA solvable deja de serlo.
 * - Sin informe previo (`before = null`, p. ej. el draft aún no pasaba el
 *   esquema) no hay línea base: todo lo del informe posterior cuenta como nuevo,
 *   salvo la no-solvabilidad (nada era solvable).
 */

export type FindingSeverity = "error" | "warning";

/** Un hallazgo del informe, aplanado y con su huella de comparación. */
export interface ValidationFinding {
  check: ValidationCheckId;
  severity: FindingSeverity;
  code: string;
  message: string;
  ids: string[];
  playerCounts?: number[];
  /** Huella estable `check|code|ids` con la que se comparan informes. */
  key: string;
}

export interface ValidationDelta {
  /** ❌ que la mutación introduce: son los que bloquean el commit. */
  introducedErrors: ValidationFinding[];
  /** ❌ que ya tenía el draft (o su equivalente): no bloquean. */
  persistingErrors: ValidationFinding[];
  /** ❌ del informe previo que ya no aparecen. */
  resolvedErrors: ValidationFinding[];
  /** 🟡 nuevos (no bloquean; se devuelven como avisos). */
  introducedWarnings: ValidationFinding[];
  /** 🟡 del informe previo que ya no aparecen. */
  resolvedWarnings: ValidationFinding[];
  /** Tamaños de grupo que eran solvables y dejan de serlo. */
  lostSolvability: number[];
  /** `true` si hay ❌ nuevos. */
  worsened: boolean;
}

/** Huella de comparación de un hallazgo. */
export function findingKey(check: string, code: string, ids: readonly string[]): string {
  return `${check}|${code}|${[...ids].sort().join(",")}`;
}

/** Hallazgos ❌/🟡 de un informe, en el orden de sus checks. */
export function validationFindings(report: ValidationReport): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const check of report.checks) {
    if (check.status === "ok") continue;
    for (const issue of check.issues) {
      findings.push({
        check: check.id,
        severity: check.status,
        code: issue.code,
        message: issue.message,
        ids: issue.ids,
        ...(issue.playerCounts ? { playerCounts: issue.playerCounts } : {}),
        key: findingKey(check.id, issue.code, issue.ids),
      });
    }
  }
  return findings;
}

const isUnsolvable = (finding: ValidationFinding) =>
  finding.check === "solvability" && finding.code === "unsolvable";

/**
 * Reparte `after` en nuevos y persistentes comparando por huella como
 * multiconjunto contra `before`, y devuelve también los de `before` que
 * desaparecen.
 */
function splitByKey(
  before: readonly ValidationFinding[],
  after: readonly ValidationFinding[],
): {
  introduced: ValidationFinding[];
  persisting: ValidationFinding[];
  resolved: ValidationFinding[];
} {
  const remaining = new Map<string, ValidationFinding[]>();
  for (const finding of before) {
    const list = remaining.get(finding.key) ?? [];
    list.push(finding);
    remaining.set(finding.key, list);
  }
  const introduced: ValidationFinding[] = [];
  const persisting: ValidationFinding[] = [];
  for (const finding of after) {
    const list = remaining.get(finding.key);
    if (list && list.length > 0) {
      list.shift();
      persisting.push(finding);
    } else {
      introduced.push(finding);
    }
  }
  const resolved = [...remaining.values()].flat();
  return { introduced, persisting, resolved };
}

/**
 * Compara el informe de un draft antes y después de una mutación con el
 * criterio documentado arriba. `before = null` = sin línea base.
 */
export function compareValidationReports(
  before: ValidationReport | null,
  after: ValidationReport,
): ValidationDelta {
  const beforeFindings = before ? validationFindings(before) : [];
  const afterFindings = validationFindings(after);

  const wasSolvable = new Set(
    (before?.solvability ?? []).filter((result) => result.solvable).map((r) => r.playerCount),
  );
  const lostSolvability = after.solvability
    .filter((result) => !result.solvable && wasSolvable.has(result.playerCount))
    .map((result) => result.playerCount);
  const lost = new Set(lostSolvability);
  const evaluated = after.solvability.map((result) => result.playerCount);

  const errorsBefore = beforeFindings.filter((f) => f.severity === "error" && !isUnsolvable(f));
  const errorsAfter = afterFindings.filter((f) => f.severity === "error" && !isUnsolvable(f));
  const errors = splitByKey(errorsBefore, errorsAfter);

  // No-solvabilidad: nueva solo si afecta a un tamaño de grupo que era solvable.
  const unsolvableAfter = afterFindings.filter(isUnsolvable);
  const unsolvableIntroduced = unsolvableAfter.filter((finding) =>
    (finding.playerCounts ?? evaluated).some((n) => lost.has(n)),
  );
  const unsolvablePersisting = unsolvableAfter.filter(
    (finding) => !unsolvableIntroduced.includes(finding),
  );
  const afterUnsolvableKeys = new Set(unsolvableAfter.map((finding) => finding.key));
  const unsolvableResolved = beforeFindings.filter(
    (finding) => isUnsolvable(finding) && !afterUnsolvableKeys.has(finding.key),
  );

  const warnings = splitByKey(
    beforeFindings.filter((f) => f.severity === "warning"),
    afterFindings.filter((f) => f.severity === "warning"),
  );

  const introducedErrors = [...errors.introduced, ...unsolvableIntroduced];
  return {
    introducedErrors,
    persistingErrors: [...errors.persisting, ...unsolvablePersisting],
    resolvedErrors: [...errors.resolved, ...unsolvableResolved],
    introducedWarnings: warnings.introduced,
    resolvedWarnings: warnings.resolved,
    lostSolvability,
    worsened: introducedErrors.length > 0,
  };
}
