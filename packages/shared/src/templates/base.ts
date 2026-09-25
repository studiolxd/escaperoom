import type { PuzzleState } from "../schemas";

/**
 * Utilidades compartidas por las 8 plantillas de puzzle (specs/06). Cada
 * plantilla sigue el mismo ciclo: arranca `locked`/`available` según
 * `requiresSolved`, rechaza intentos mientras no sea jugable y expone una
 * vista pública con los campos comunes (`id`, `type`, `state`, `solvedAt`,
 * `solvedBy`). Antes de esta extracción (D-20) cada plantilla repetía este
 * prólogo con una ligera variación de nombres.
 */

/** Estado inicial: `locked` si depende de otro puzzle aún sin resolver. */
export function initialPuzzleState(requiresSolved: readonly unknown[]): PuzzleState {
  return requiresSolved.length > 0 ? "locked" : "available";
}

/**
 * Motivo por el que un intento no debe procesarse dado el estado actual, o
 * `null` si puede continuar. Cada plantilla decide cómo construir el
 * resultado concreto (forma de retorno propia) a partir de este motivo.
 */
export type PlayabilityGuard = "already_solved" | "unavailable" | null;

export function guardPlayable(state: PuzzleState): PlayabilityGuard {
  if (state === "solved") return "already_solved";
  if (state === "locked" || state === "failed") return "unavailable";
  return null;
}

/** Campos comunes a toda vista pública de un puzzle. */
export interface PublicBaseFields<Type extends string> {
  id: string;
  type: Type;
  state: PuzzleState;
  solvedAt: number | null;
  solvedBy: string | null;
}

/**
 * Comparación en tiempo constante para respuestas de puzzle (código,
 * fragmento…). `node:crypto` no vale aquí: estas plantillas se bundlean
 * también para el cliente (vista previa del editor), así que la comparación
 * se hace a mano sobre `charCodeAt`, sin cortocircuitar por longitud (D-15;
 * el impacto práctico es nulo por el lockout y el jitter de red, es higiene).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function publicBase<Type extends string>(
  id: string,
  type: Type,
  state: PuzzleState,
  solvedAt: number | undefined,
  solvedBy: string | undefined,
): PublicBaseFields<Type> {
  return { id, type, state, solvedAt: solvedAt ?? null, solvedBy: solvedBy ?? null };
}
