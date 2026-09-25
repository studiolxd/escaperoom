import type { CodeLockDefinition, PuzzleState } from "../schemas";
import { constantTimeEqual, guardPlayable, initialPuzzleState, publicBase } from "./base";

/**
 * Plantilla `code_lock` (specs/06 §2.2). Toda la validación vive aquí, en
 * `shared`: el servidor compara el código contra la definición y el cliente
 * solo recibe una proyección pública (`toCodeLockPublicView`) que jamás
 * incluye `code`.
 *
 * La lógica es pura: `attemptCode` no muta `state`, devuelve un estado nuevo.
 * Así el host (Colyseus/React) puede decidir cuándo y cómo persistirlo, y los
 * tests corren sin infraestructura.
 */

/** Intentos por defecto cuando la definición no los fija (specs/06 §2.2). */
export const CODE_LOCK_DEFAULT_MAX_ATTEMPTS = 5;

/** Bloqueo temporal por defecto en segundos (specs/06 §2.2, ticket 1.6). */
export const CODE_LOCK_DEFAULT_LOCKOUT_SEC = 30;

/** Estado interno de un `code_lock` (nunca sale al cliente tal cual). */
export interface CodeLockState {
  /** `locked` si aún debe resolverse algo; `failed` solo si el fallo es definitivo. */
  state: PuzzleState;
  /** Códigos enviados desde el último desbloqueo (se reinicia tras un lockout). */
  attempts: number;
  /** Instante ms hasta el que el candado está bloqueado, o `null` si no lo está. */
  lockedUntil: number | null;
  solvedAt?: number;
  solvedBy?: string;
}

/** Resultado que el servidor devuelve tras un intento. */
export type CodeLockAttemptOutcome =
  "correct" | "wrong" | "locked_out" | "unavailable" | "already_solved";

export interface CodeLockAttemptResult {
  outcome: CodeLockAttemptOutcome;
  /** Estado resultante (nuevo objeto; `state` de entrada no se muta). */
  state: CodeLockState;
  remainingAttempts: number;
  lockedUntil: number | null;
}

/**
 * Proyección que viaja al cliente: todo lo que el panel necesita para pintar
 * el teclado, los intentos y la cuenta atrás, **sin** el código ni la solución.
 */
export interface CodeLockPublicView {
  id: string;
  type: "code_lock";
  length: number;
  state: PuzzleState;
  attempts: number;
  maxAttempts: number;
  remainingAttempts: number;
  lockoutSec: number;
  lockedUntil: number | null;
  hints: string[];
  solvedAt: number | null;
  solvedBy: string | null;
}

function maxAttemptsOf(def: CodeLockDefinition): number {
  return def.maxAttempts ?? CODE_LOCK_DEFAULT_MAX_ATTEMPTS;
}

function lockoutSecOf(def: CodeLockDefinition): number {
  return def.lockoutSec ?? CODE_LOCK_DEFAULT_LOCKOUT_SEC;
}

function remainingAttemptsOf(state: CodeLockState, def: CodeLockDefinition): number {
  return Math.max(0, maxAttemptsOf(def) - state.attempts);
}

/** Un candado con `requiresSolved` pendiente arranca `locked`; si no, `available`. */
export function createCodeLockState(def: CodeLockDefinition): CodeLockState {
  return {
    state: initialPuzzleState(def.requiresSolved),
    attempts: 0,
    lockedUntil: null,
  };
}

/** `true` si el candado está en su ventana de bloqueo temporal. */
export function isCodeLockLockedOut(state: CodeLockState, now: number): boolean {
  return state.lockedUntil !== null && now < state.lockedUntil;
}

/**
 * Aplica un intento. No acepta intentos durante el bloqueo (no incrementan
 * `attempts`), compara contra `def.code` y, al agotar `maxAttempts`, aplica
 * `lockoutSec` (bloqueo temporal recuperable) o `failed` definitivo si es 0.
 */
export function attemptCode(
  state: CodeLockState,
  def: CodeLockDefinition,
  input: string,
  now: number,
): CodeLockAttemptResult {
  const current = clearExpiredLockout(state, now);
  const base = {
    remainingAttempts: remainingAttemptsOf(current, def),
    lockedUntil: current.lockedUntil,
  };

  const guard = guardPlayable(current.state);
  if (guard !== null) {
    return { outcome: guard, state: current, ...base };
  }
  if (current.lockedUntil !== null) {
    return { outcome: "locked_out", state: current, ...base };
  }

  if (constantTimeEqual(normalizeCode(input), normalizeCode(def.code))) {
    const next: CodeLockState = {
      ...current,
      state: "solved",
      attempts: current.attempts + 1,
      lockedUntil: null,
      solvedAt: now,
    };
    return { outcome: "correct", state: next, remainingAttempts: 0, lockedUntil: null };
  }

  const attempts = current.attempts + 1;
  const maxAttempts = maxAttemptsOf(def);

  if (attempts >= maxAttempts) {
    const lockoutSec = lockoutSecOf(def);
    if (lockoutSec > 0) {
      const lockedUntil = now + lockoutSec * 1000;
      const next: CodeLockState = { ...current, state: "available", attempts: 0, lockedUntil };
      return { outcome: "locked_out", state: next, remainingAttempts: maxAttempts, lockedUntil };
    }
    const next: CodeLockState = { ...current, state: "failed", attempts, lockedUntil: null };
    return { outcome: "locked_out", state: next, remainingAttempts: 0, lockedUntil: null };
  }

  const next: CodeLockState = { ...current, state: "in_progress", attempts, lockedUntil: null };
  return {
    outcome: "wrong",
    state: next,
    remainingAttempts: remainingAttemptsOf(next, def),
    lockedUntil: null,
  };
}

/**
 * Proyección pública: no incluye `code` ni la solución. `hints` sí viaja,
 * pero son ids de `HintDef` (specs/06), no el texto de la pista — el cliente
 * los resuelve aparte contra el catálogo de pistas de la sala.
 */
export function toCodeLockPublicView(
  state: CodeLockState,
  def: CodeLockDefinition,
): CodeLockPublicView {
  const maxAttempts = maxAttemptsOf(def);
  return {
    ...publicBase(def.id, "code_lock", state.state, state.solvedAt, state.solvedBy),
    length: def.length,
    attempts: state.attempts,
    maxAttempts,
    remainingAttempts: Math.max(0, maxAttempts - state.attempts),
    lockoutSec: lockoutSecOf(def),
    lockedUntil: state.lockedUntil,
    hints: [...(def.hints ?? [])],
  };
}

/**
 * Comprobación simple para el validador futuro: la definición es coherente
 * (código numérico de la longitud declarada) y el estado aún puede resolverse.
 */
export function isCodeLockSolvable(state: CodeLockState, def: CodeLockDefinition): boolean {
  if (state.state === "solved") return true;
  if (state.state === "failed" && state.lockedUntil === null) return false;
  return isCoherentCodeLockDefinition(def);
}

/** `true` si `code` casa con `length` y son solo dígitos. */
export function isCoherentCodeLockDefinition(def: CodeLockDefinition): boolean {
  if (def.length <= 0 || def.code.length !== def.length) return false;
  return new RegExp(`^[0-9]{${def.length}}$`).test(def.code);
}

function clearExpiredLockout(state: CodeLockState, now: number): CodeLockState {
  if (state.lockedUntil !== null && now >= state.lockedUntil) {
    return { ...state, lockedUntil: null };
  }
  return state;
}

function normalizeCode(value: string): string {
  return value.trim();
}

/**
 * Alias sin prefijo de `toCodeLockPublicView`/`isCodeLockSolvable` (D-20).
 * `packages/shared/src/session/room-session.ts` (bloque 4, en curso en
 * paralelo) todavía importa los nombres antiguos; se retiran cuando ese
 * bloque haga el rename en su propia PR.
 */
export const toPublicView = toCodeLockPublicView;
export const isSolvableGiven = isCodeLockSolvable;
