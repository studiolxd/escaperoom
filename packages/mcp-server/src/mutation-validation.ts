import { createHash } from "node:crypto";
import { safeParseRoomPackage, toReadableIssues } from "@escaperoom/shared/schemas";
import {
  compareValidationReports,
  validateRoomPackage,
  type ValidationFinding,
  type ValidationReport,
} from "@escaperoom/shared/validator";
import * as Y from "yjs";
import { ToolError } from "./results";
import type { DraftDoc, RoomDocToPackage } from "./room-draft-reader";

/**
 * Validador incremental del pipeline de mutación (ticket 4.4, specs/10 §3,
 * pasos 2–4): foto del draft antes y después de la mutación en dry-run y
 * veredicto "¿la mutación empeora el draft?".
 *
 * Criterio (documentado también en el README):
 *
 * 1. Si el draft pasa el esquema RoomPackage antes y después, se comparan los
 *    informes del validador con `compareValidationReports`: se rechaza solo si
 *    la mutación INTRODUCE ❌ nuevos (un dead end, una referencia rota, perder
 *    la solvabilidad de un tamaño de grupo que la tenía). Los ❌ que el draft
 *    ya tenía no bloquean; los 🟡 nuevos se devuelven como avisos.
 * 2. Si la mutación saca al draft del esquema, se rechaza.
 * 3. Si el draft ya estaba fuera del esquema, se rechaza solo si aparecen
 *    problemas de esquema nuevos (comparados por ruta —con el id de la entidad
 *    en vez del índice— y mensaje).
 * 4. Si el draft estaba fuera del esquema y la mutación lo arregla, se acepta:
 *    no hay informe previo con el que atribuir los ❌, así que se devuelven como
 *    errores pendientes, sin bloquear.
 * 5. Sin conversión doc → RoomPackage inyectada, no se valida (se escribe).
 */

/** Problema de esquema del draft, con su huella de comparación. */
export type SchemaProblem = { key: string; path: string; message: string };

/** Foto del draft para el validador incremental. */
export type DraftSnapshot =
  { status: "valid"; report: ValidationReport } | { status: "invalid"; problems: SchemaProblem[] };

/** Colecciones del RoomPackage cuyas entradas tienen `id` (para huellas estables). */
const ID_COLLECTIONS = new Set([
  "objects",
  "items",
  "puzzles",
  "rules",
  "dialogs",
  "hints",
  "rooms",
]);

/** `objects.3.position` → `objects[cofre].position` cuando la entrada 3 tiene id. */
function stablePath(raw: unknown, path: string): string {
  const segments = path.split(".").filter(Boolean);
  let node: unknown = raw;
  return segments
    .map((segment, index) => {
      const parent = node;
      node =
        parent && typeof parent === "object"
          ? (parent as Record<string, unknown>)[segment]
          : undefined;
      const collection = segments[index - 1];
      if (collection && ID_COLLECTIONS.has(collection) && /^\d+$/u.test(segment)) {
        const id = node && typeof node === "object" ? (node as { id?: unknown }).id : undefined;
        if (typeof id === "string" && id) return `[${id}]`;
      }
      return segment;
    })
    .join(".")
    .replace(/\.\[/gu, "[");
}

/**
 * Serializa el doc UNA vez (`roomDocToPackage`), lo pasa por el esquema y, si
 * es un RoomPackage, corre el validador.
 */
export function snapshotDraft(doc: DraftDoc, toPackage: RoomDocToPackage): DraftSnapshot {
  const raw = toPackage(doc);
  const parsed = safeParseRoomPackage(raw);
  if (!parsed.success) {
    const problems = toReadableIssues(parsed.error).map(({ path, message }) => {
      const stable = stablePath(raw, path);
      return { key: `${stable}|${message}`, path: stable || "(raíz)", message };
    });
    return { status: "invalid", problems };
  }
  return { status: "valid", report: validateRoomPackage(parsed.data) };
}

/**
 * Caché de fotos por contenido del draft. La foto "después" de un commit es la
 * "antes" de la siguiente mutación sobre la misma sala: con la caché, una
 * construcción paso a paso serializa y valida UNA vez por llamada. La clave es
 * un hash del estado Yjs completo (no basta el vector de estado: los borrados
 * no avanzan el reloj), así que un acierto implica el mismo contenido.
 */
export class DraftSnapshotCache {
  private readonly entries = new Map<string, DraftSnapshot>();
  hits = 0;
  misses = 0;
  constructor(private readonly capacity = 64) {}

  static key(roomId: string, doc: Y.Doc): string {
    const digest = createHash("sha256").update(Y.encodeStateAsUpdate(doc)).digest("base64url");
    return `${roomId}:${digest}`;
  }

  get(key: string): DraftSnapshot | undefined {
    const snapshot = this.entries.get(key);
    if (snapshot) {
      this.hits++;
      // LRU: se reinsertan al final los usados.
      this.entries.delete(key);
      this.entries.set(key, snapshot);
    } else {
      this.misses++;
    }
    return snapshot;
  }

  set(key: string, snapshot: DraftSnapshot): void {
    this.entries.delete(key);
    this.entries.set(key, snapshot);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** Caché compartida por defecto (el servidor HTTP crea deps por petición). */
export const defaultSnapshotCache = new DraftSnapshotCache();

/** Hallazgo tal y como se devuelve al agente. */
export type FindingView = Pick<ValidationFinding, "check" | "code" | "message" | "ids">;

/** Resultado del validador incremental para una mutación aceptada. */
export type MutationValidation = {
  /** `validated` = informe comparado; `schema` = el draft aún no es un RoomPackage. */
  status: "validated" | "schema";
  /** `true` si el draft resultante no tiene ❌ (condición de `publish`). */
  ok: boolean;
  /** 🟡 que introduce la mutación (no bloquean). */
  newWarnings: FindingView[];
  /** ❌ que el draft ya tenía y siguen ahí (no bloquean). */
  pendingErrors: FindingView[];
  /** ❌ que la mutación resuelve. */
  resolvedErrors: FindingView[];
  /** Problemas de esquema que quedan (solo con `status: "schema"`). */
  schemaProblems: string[];
};

const view = ({ check, code, message, ids }: ValidationFinding): FindingView => ({
  check,
  code,
  message,
  ids,
});

/** Informe resumido: una línea por check ❌/🟡 (sin la ruta crítica). */
function reportSummary(report: ValidationReport): string[] {
  return report.checks
    .filter((check) => check.status !== "ok" && !check.passed)
    .map((check) => `${check.status === "error" ? "❌" : "🟡"} ${check.summary}`);
}

/** Qué puede hacer el agente según el check que se rompe. */
const FIX_HINTS: Partial<Record<ValidationFinding["check"], string>> = {
  references:
    "corrige el id referenciado (el mensaje lista los disponibles) o crea antes la entidad a la que apunta",
  dead_ends:
    "crea primero lo que lo desbloquea (el puzzle, item o regla del que depende) y después este elemento, o cambia su dependencia (lockedBy, requiresSolved, condiciones)",
  solvability:
    "la mutación corta la ruta a la victoria para algún tamaño de grupo que la tenía: revisa la dependencia que añade o cambia",
};

/** Lista con un máximo de líneas visibles. */
function bullets(lines: readonly string[], max = 8): string[] {
  const shown = lines.slice(0, max).map((line) => `   · ${line}`);
  if (lines.length > max) shown.push(`   · … y ${lines.length - max} más`);
  return shown;
}

function rejection(
  tool: string,
  dryRun: boolean,
  lines: string[],
  details: Record<string, unknown>,
): ToolError {
  const verdict = dryRun
    ? "(dry-run) la mutación se rechazaría"
    : "mutación rechazada, no se ha escrito nada en el draft";
  return new ToolError("VALIDATION_FAILED", `${verdict}. ${lines.join("\n")}`, {
    tool,
    dryRun,
    ...details,
  });
}

/**
 * Veredicto del validador incremental. Devuelve la validación de una mutación
 * aceptada o lanza un `ToolError("VALIDATION_FAILED")` accionable.
 */
export function judgeMutation(
  tool: string,
  before: DraftSnapshot,
  after: DraftSnapshot,
  opts: { dryRun: boolean },
): MutationValidation {
  if (after.status === "invalid") {
    const known = new Map<string, number>();
    if (before.status === "invalid") {
      for (const problem of before.problems)
        known.set(problem.key, (known.get(problem.key) ?? 0) + 1);
    }
    const introduced = after.problems.filter((problem) => {
      const count = known.get(problem.key) ?? 0;
      if (count > 0) known.set(problem.key, count - 1);
      return count === 0;
    });
    if (introduced.length > 0) {
      const lines = [
        before.status === "valid"
          ? `Deja el draft fuera del esquema RoomPackage (${introduced.length} problema(s)):`
          : `Añade ${introduced.length} problema(s) de esquema nuevos al draft:`,
        ...bullets(introduced.map((problem) => `${problem.path}: ${problem.message}`)),
        "Corrige esos campos y vuelve a intentarlo (puedes probar antes con `dryRun: true`).",
      ];
      throw rejection(tool, opts.dryRun, lines, {
        reason: "SCHEMA_REGRESSION",
        schemaProblems: introduced.map(({ path, message }) => ({ path, message })),
      });
    }
    return {
      status: "schema",
      ok: false,
      newWarnings: [],
      pendingErrors: [],
      resolvedErrors: [],
      schemaProblems: after.problems.map((problem) => `${problem.path}: ${problem.message}`),
    };
  }

  // Sin informe previo (el draft no pasaba el esquema) no se atribuyen ❌: pendientes.
  const baseline = before.status === "valid" ? before.report : null;
  const delta = compareValidationReports(baseline, after.report);
  if (baseline && delta.worsened) {
    const hints = [...new Set(delta.introducedErrors.map((finding) => finding.check))]
      .map((check) => FIX_HINTS[check])
      .filter((hint): hint is string => Boolean(hint));
    const lines = [
      `Introduce ${delta.introducedErrors.length} error(es) nuevo(s) en el validador:`,
      ...bullets(delta.introducedErrors.map((finding) => `[${finding.check}] ${finding.message}`)),
      ...(hints.length > 0 ? ["Qué hacer:", ...bullets(hints)] : []),
      "Informe resumido tras la mutación:",
      ...bullets(reportSummary(after.report), 12),
      ...(delta.persistingErrors.length > 0
        ? [
            `(El draft ya tenía ${delta.persistingErrors.length} error(es) que no bloquean esta mutación.)`,
          ]
        : []),
    ];
    throw rejection(tool, opts.dryRun, lines, {
      reason: "VALIDATION_REGRESSION",
      introducedErrors: delta.introducedErrors.map(view),
      lostSolvability: delta.lostSolvability,
      preexistingErrors: delta.persistingErrors.length,
      report: {
        ok: after.report.ok,
        checks: after.report.checks.map(({ id, status, summary }) => ({ id, status, summary })),
      },
    });
  }
  return {
    status: "validated",
    ok: after.report.ok,
    newWarnings: delta.introducedWarnings.map(view),
    pendingErrors: (baseline
      ? delta.persistingErrors
      : [...delta.introducedErrors, ...delta.persistingErrors]
    ).map(view),
    resolvedErrors: delta.resolvedErrors.map(view),
    schemaProblems: [],
  };
}

/** Líneas que se añaden al texto de éxito de una mutación. */
export function describeValidation(validation: MutationValidation): string[] {
  const lines: string[] = [];
  if (validation.status === "schema") {
    lines.push(
      `ℹ️ El draft aún no es un RoomPackage completo (${validation.schemaProblems.length} problema(s) de esquema; no bloquean mientras no aumenten):`,
      ...bullets(validation.schemaProblems, 5),
    );
    return lines;
  }
  if (validation.newWarnings.length > 0) {
    lines.push(
      "🟡 Avisos nuevos (no bloquean):",
      ...bullets(validation.newWarnings.map((w) => `[${w.check}] ${w.message}`)),
    );
  }
  if (validation.resolvedErrors.length > 0) {
    lines.push(`✅ Resuelve ${validation.resolvedErrors.length} error(es) del validador.`);
  }
  if (validation.pendingErrors.length > 0) {
    lines.push(
      `ℹ️ El draft sigue con ${validation.pendingErrors.length} error(es) pendiente(s) (no bloquean esta mutación):`,
      ...bullets(
        validation.pendingErrors.map((e) => `[${e.check}] ${e.message}`),
        5,
      ),
    );
  } else if (validation.ok) {
    lines.push("✅ Validador sin errores.");
  }
  return lines;
}
