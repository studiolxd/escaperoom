/**
 * Tipos del informe de validación (specs/22 §2). El informe es un dato
 * estructurado, estable y serializable: lo consumen el editor (3.7), la
 * publicación (3.9, `POST /validate`) y el renderizado de texto
 * (`renderValidationReport`).
 */

/** Resultado de un check: ✅ `ok`, 🟡 `warning` (no bloquea), ❌ `error` (bloquea). */
export type ValidationStatus = "ok" | "warning" | "error";

/** Checks del informe, en el orden en que se renderizan. */
export type ValidationCheckId =
  | "references"
  | "orphans"
  | "dead_ends"
  | "solvability"
  | "code_hints"
  | "rule_cuts"
  | "double_use"
  | "difficulty";

/** Hallazgo concreto dentro de un check, con mensaje accionable. */
export interface ValidationIssue {
  /** Código estable del hallazgo (p. ej. `item_without_source`). */
  code: string;
  /** Mensaje en español, accionable (qué falta y dónde). */
  message: string;
  /** Ids implicados (objetos, items, puzzles, reglas…). */
  ids: string[];
  /** Tamaños de grupo en los que aparece, si no es en todos. */
  playerCounts?: number[];
}

export interface ValidationCheck {
  id: ValidationCheckId;
  status: ValidationStatus;
  /**
   * `true` en los heurísticos no bloqueantes de specs/22 §2.4: se renderizan
   * siempre como 🟡 (aviso), aunque su comprobación pase (`passed`).
   */
  heuristic: boolean;
  /** `true` si el check no encontró problemas. */
  passed: boolean;
  /** Línea del informe, sin el icono. */
  summary: string;
  issues: ValidationIssue[];
}

/** Tipo de paso de la ruta crítica. */
export type RouteStepKind =
  "solve_puzzle" | "combine" | "use_item" | "interact" | "enter_room" | "zone" | "timer";

/** Un paso de la secuencia de solución encontrada por BFS (specs/22 §2.5). */
export interface RouteStep {
  /** Posición 1-based dentro de la ruta. */
  index: number;
  kind: RouteStepKind;
  /** Puzzle, objeto, habitación, regla o timer protagonista del paso. */
  subjectId: string;
  /** Plantilla, si el paso resuelve un puzzle (o `combine_items`). */
  puzzleType?: string;
  /** Descripción legible (lado izquierdo del informe). */
  description: string;
  /** Consecuencias legibles (lado derecho: `→ …`). */
  outcome: string;
  itemsGained: string[];
  itemsConsumed: string[];
  /** Ítems presentados sin gastarse (objetos-puente del modo solitario). */
  itemsUsed: string[];
  rulesFired: string[];
  puzzlesSolved: string[];
  roomsEntered: string[];
  victory: boolean;
  /** Minutos estimados para el paso (constantes de `DURATION_WEIGHTS`). */
  minutes: number;
}

/** Precondición no cumplida de un elemento bloqueado. */
export interface BlockedEntry {
  kind: "puzzle" | "door" | "rule" | "item";
  id: string;
  reasons: string[];
}

/** Resultado del test de solvabilidad para un tamaño de grupo. */
export interface SolvabilityResult {
  playerCount: number;
  solvable: boolean;
  /** Ruta crítica (la más corta por BFS) o `null` si no hay victoria. */
  route: RouteStep[] | null;
  /**
   * `true` si la ruta solo existe ignorando las dependencias de pistas de
   * código (dígitos revelados por reglas): la sala se considera solvable pero
   * el orden de descubrimiento no encaja (🟡 en `code_hints`).
   */
  ignoredClueOrder: boolean;
  /** `true` si se agotó el presupuesto de estados de la búsqueda exacta. */
  searchTruncated: boolean;
  /** Estados explorados por la búsqueda exacta. */
  exploredStates: number;
  /** Qué quedó bloqueado y por qué (solo si no es solvable). */
  blocked: BlockedEntry[];
}

/** Estimación de duración (specs/22 §2.5). */
export interface DurationEstimate {
  /** Tamaño de grupo cuya ruta se usa (el más restrictivo: `players.min`). */
  playerCount: number;
  routeSteps: number;
  minutes: number;
  range: { min: number; max: number };
  /** Dificultad esperada según nº de puzzles y minutos estimados. */
  expectedDifficulty: 1 | 2 | 3;
}

/** Dígito de un `code_lock` que se descubre jugando (una regla lo revela). */
export interface CodeClueDigit {
  position: number;
  digit: string;
  ruleId: string;
}

export interface CodeLockClues {
  puzzleId: string;
  hintIds: string[];
  revealedDigits: CodeClueDigit[];
}

/** Ítem con varios usos donde al menos uno lo gasta (specs/22 §2.4). */
export interface DoubleUseItem {
  itemId: string;
  uses: string[];
  consumingUses: string[];
  /** Regla repetible que lo devuelve, si la hay (patrón `r-recoger-caliz`). */
  resolvedBy: string | null;
  conflict: boolean;
}

export interface ValidationReport {
  roomId: string;
  /** `true` si ningún check es ❌ (condición para `publish()`). */
  ok: boolean;
  checks: ValidationCheck[];
  /** Un resultado por tamaño de grupo en `players.min..players.max`. */
  solvability: SolvabilityResult[];
  /** Ruta crítica reportada (la del grupo más restrictivo que es solvable). */
  criticalRoute: { playerCount: number; steps: RouteStep[] } | null;
  estimate: DurationEstimate | null;
  codeClues: CodeLockClues[];
  doubleUse: DoubleUseItem[];
}

export interface ValidateOptions {
  /**
   * Tamaños de grupo a evaluar. Por defecto, todos los de
   * `meta.players.min..players.max` (specs/22 §2.1).
   */
  playerCounts?: number[];
  /** Presupuesto de estados de la búsqueda exacta por tamaño de grupo. */
  maxStates?: number;
}
