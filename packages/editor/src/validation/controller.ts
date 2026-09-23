import type { RoomPackage } from "@escaperoom/shared/schemas";
import {
  validateRoomPackage,
  type ValidateOptions,
  type ValidationReport,
} from "@escaperoom/shared/validator";
import type * as Y from "yjs";
import {
  collectFindings,
  findingsToIssues,
  toRuleGraphIssues,
  type EditorIssue,
  type ValidationFinding,
} from "./findings";
import {
  docToRoomPackage,
  type DocConversionError,
  type RoomPackageSerializer,
} from "./serializer";

/**
 * Validación continua del editor (specs/09 §5): a cada cambio del doc Yjs
 * (local o remoto) programa, con debounce, doc → RoomPackage → validate y
 * publica el estado a sus suscriptores. Headless: el hook de React y el panel
 * solo lo leen.
 */

/** Espera por defecto tras el último cambio antes de revalidar. */
export const DEFAULT_VALIDATION_DEBOUNCE_MS = 400;

export type RoomValidationState = {
  /**
   * `idle` antes de la primera pasada; `ready` con informe; `invalid` si el
   * doc aún no forma un `RoomPackage` válido (ver `conversionErrors`).
   */
  status: "idle" | "ready" | "invalid";
  /** `true` si hay cambios del doc pendientes de revalidar (debounce en curso). */
  pending: boolean;
  report: ValidationReport | null;
  pkg: RoomPackage | null;
  findings: ValidationFinding[];
  /** Un problema por elemento señalado (ids de reglas, puzzles, objetos…). */
  issues: EditorIssue[];
  /** Los de `issues` que son reglas, listos para `<RulesGraph issues>`. */
  ruleGraphIssues: ReturnType<typeof toRuleGraphIssues>;
  conversionErrors: DocConversionError[];
  /** Nº de pasadas completadas (útil para tests y para animar el panel). */
  runs: number;
};

export const INITIAL_VALIDATION_STATE: RoomValidationState = {
  status: "idle",
  pending: false,
  report: null,
  pkg: null,
  findings: [],
  issues: [],
  ruleGraphIssues: [],
  conversionErrors: [],
  runs: 0,
};

export type RoomValidatorOptions = {
  doc: Y.Doc;
  serialize: RoomPackageSerializer;
  debounceMs?: number;
  /** Opciones del validador (manifest del pack, tamaños de grupo…). */
  validateOptions?: ValidateOptions;
  /** Inyectable para tests; por defecto `validateRoomPackage`. */
  validate?: (pkg: RoomPackage, options?: ValidateOptions) => ValidationReport;
  /** Valida al crearse (por defecto `true`). */
  immediate?: boolean;
};

export type RoomValidator = {
  getState(): RoomValidationState;
  subscribe(listener: () => void): () => void;
  /** Valida ya, cancelando el debounce pendiente. */
  validateNow(): RoomValidationState;
  destroy(): void;
};

export function createRoomValidator(options: RoomValidatorOptions): RoomValidator {
  const { doc, serialize } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_VALIDATION_DEBOUNCE_MS;
  const validate = options.validate ?? validateRoomPackage;
  const listeners = new Set<() => void>();
  let state = INITIAL_VALIDATION_STATE;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const emit = (next: RoomValidationState) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const run = (): RoomValidationState => {
    clearTimer();
    const runs = state.runs + 1;
    const converted = docToRoomPackage(doc, serialize);
    if (!converted.ok) {
      emit({
        ...INITIAL_VALIDATION_STATE,
        status: "invalid",
        conversionErrors: converted.errors,
        runs,
      });
      return state;
    }
    const report = validate(converted.pkg, options.validateOptions);
    const findings = collectFindings(report, converted.pkg);
    const issues = findingsToIssues(findings);
    emit({
      status: "ready",
      pending: false,
      report,
      pkg: converted.pkg,
      findings,
      issues,
      ruleGraphIssues: toRuleGraphIssues(issues),
      conversionErrors: [],
      runs,
    });
    return state;
  };

  const onUpdate = () => {
    if (destroyed) return;
    clearTimer();
    timer = setTimeout(run, debounceMs);
    if (!state.pending) emit({ ...state, pending: true });
  };

  doc.on("update", onUpdate);
  if (options.immediate ?? true) run();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    validateNow: () => (destroyed ? state : run()),
    destroy() {
      destroyed = true;
      clearTimer();
      doc.off("update", onUpdate);
      listeners.clear();
    },
  };
}
