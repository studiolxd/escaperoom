import type { RoomPackage } from "@escaperoom/shared/schemas";
import type { ValidationCheckId, ValidationReport } from "@escaperoom/shared/validator";
import type { RuleGraphIssue } from "../rules-graph/graph-model";

/**
 * Hallazgos del informe del validador mapeados a elementos del editor
 * (specs/09 §5): cada id del informe se resuelve contra el paquete para saber
 * si es una regla, un puzzle, un objeto… y así resaltarlo donde se edita.
 */

export type FindingSeverity = "error" | "warning";

/** Tipo de elemento del editor al que apunta un hallazgo. */
export type ValidationTargetKind =
  | "rule"
  | "puzzle"
  | "object"
  | "item"
  | "room"
  | "hint"
  | "dialog"
  /** Id que no existe en el paquete (p. ej. una referencia rota). */
  | "unknown";

export type ValidationTarget = { kind: ValidationTargetKind; id: string };

export type ValidationFinding = {
  /** Clave estable para listas de React (`check/code/índice`). */
  key: string;
  checkId: ValidationCheckId;
  code: string;
  severity: FindingSeverity;
  /** Mensaje accionable del validador (en español, como el informe). */
  message: string;
  targets: ValidationTarget[];
  /** Tamaños de grupo en los que aparece, si no es en todos. */
  playerCounts?: number[];
};

/** Hallazgo aplanado por elemento: lo que consume el resto del editor. */
export type EditorIssue = {
  id: string;
  kind: ValidationTargetKind;
  severity: FindingSeverity;
  message: string;
  checkId: ValidationCheckId;
  code: string;
};

/** Orden de resolución si un mismo id existiera en varias colecciones. */
const KIND_ORDER: readonly Exclude<ValidationTargetKind, "unknown">[] = [
  "rule",
  "puzzle",
  "object",
  "item",
  "room",
  "hint",
  "dialog",
];

function indexKinds(pkg: RoomPackage): Map<string, ValidationTargetKind> {
  const ids: Record<Exclude<ValidationTargetKind, "unknown">, string[]> = {
    rule: pkg.rules.map((rule) => rule.id),
    puzzle: pkg.puzzles.map((puzzle) => puzzle.id),
    object: pkg.objects.map((object) => object.id),
    item: pkg.items.map((item) => item.id),
    room: pkg.map.rooms.map((room) => room.id),
    hint: pkg.hints.map((hint) => hint.id),
    dialog: pkg.dialogs.map((dialog) => dialog.id),
  };
  const kinds = new Map<string, ValidationTargetKind>();
  for (const kind of KIND_ORDER) {
    for (const id of ids[kind]) if (!kinds.has(id)) kinds.set(id, kind);
  }
  return kinds;
}

/**
 * Hallazgos accionables del informe: los issues de los checks que no pasan.
 * Un check heurístico que pasa (p. ej. la línea informativa de pistas de
 * código o la de dificultad) no genera hallazgos: su resumen va al panel.
 */
export function collectFindings(report: ValidationReport, pkg: RoomPackage): ValidationFinding[] {
  const kinds = indexKinds(pkg);
  const findings: ValidationFinding[] = [];
  for (const check of report.checks) {
    if (check.passed || check.status === "ok") continue;
    const severity: FindingSeverity = check.status === "error" ? "error" : "warning";
    check.issues.forEach((issue, i) => {
      findings.push({
        key: `${check.id}/${issue.code}/${i}`,
        checkId: check.id,
        code: issue.code,
        severity,
        message: issue.message,
        targets: [...new Set(issue.ids)].map((id) => ({ id, kind: kinds.get(id) ?? "unknown" })),
        ...(issue.playerCounts ? { playerCounts: issue.playerCounts } : {}),
      });
    });
  }
  return findings;
}

/** Aplana los hallazgos a un `EditorIssue` por elemento señalado. */
export function findingsToIssues(findings: readonly ValidationFinding[]): EditorIssue[] {
  return findings.flatMap((finding) =>
    finding.targets.map((target) => ({
      id: target.id,
      kind: target.kind,
      severity: finding.severity,
      message: finding.message,
      checkId: finding.checkId,
      code: finding.code,
    })),
  );
}

/** Problemas de reglas en el formato del hook `issues` de `<RulesGraph>` (3.6). */
export function toRuleGraphIssues(issues: readonly EditorIssue[]): RuleGraphIssue[] {
  return issues
    .filter((issue) => issue.kind === "rule")
    .map((issue) => ({ id: issue.id, severity: issue.severity, message: issue.message }));
}

/** Peor severidad por id (para pintar objetos, puzzles… en el resto del editor). */
export function severityById(issues: readonly EditorIssue[]): Map<string, FindingSeverity> {
  const map = new Map<string, FindingSeverity>();
  for (const issue of issues) {
    if (map.get(issue.id) !== "error") map.set(issue.id, issue.severity);
  }
  return map;
}
