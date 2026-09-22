import type { HintDef } from "../schemas";
import {
  DEFAULT_LOCALE,
  resolveLocalizedEntry,
  type ResolvedLocalizedEntry,
} from "./localized-text";

/**
 * Sistema de pistas (specs/05 §3, specs/08 §2.3): tiers escalonados con coste
 * sobre un contador global de pistas restantes. Toda la lógica es **pura** y
 * vive en `shared`, de modo que el servidor (Colyseus) la evalúe sobre el
 * estado de partida y los tests corran sin infraestructura.
 *
 * `requestHint` no muta `state`: devuelve un estado nuevo o un rechazo con
 * motivo claro. La proyección `toHintPublicView` resuelve los `LocalizedText` al
 * idioma activo (con fallback) y nunca expone pistas que no se hayan pedido.
 */

/** Motivo de rechazo de `requestHint` (estable para i18n y analítica). */
export type HintRequestErrorCode = "unknown_puzzle" | "no_more_tiers" | "insufficient_hints";

export interface HintRequestError {
  code: HintRequestErrorCode;
  /** Mensaje legible (en `es`) para logs y respuestas del servidor. */
  message: string;
}

/**
 * Estado del sistema de pistas. Los `Record` siguen el patrón del `GameState`
 * (specs/05 §1) para viajar en JSON sin pérdida.
 */
export interface HintState {
  /** Pistas restantes del contador global. */
  remaining: number;
  /** Pistas consumidas del contador global (suma de costes). */
  used: number;
  /** Último tier desbloqueado por puzzle (`0` = ninguna pista pedida). */
  tierByPuzzle: Record<string, number>;
  /** Coste total consumido por puzzle. */
  usedByPuzzle: Record<string, number>;
}

export interface HintStateOptions {
  /**
   * Pistas totales del contador global. Por defecto, la suma de los costes de
   * todas las pistas, de modo que una partida pueda agotar todos los tiers.
   */
  totalHints?: number;
  /** Pistas ya consumidas (para rehidratar una partida en curso). */
  usedHints?: number;
}

export interface HintRequestSuccess {
  ok: true;
  state: HintState;
  hint: HintDef;
  tier: number;
  cost: number;
  remaining: number;
  /** `true` si, tras esta pista, el puzzle ya no tiene más tiers. */
  exhausted: boolean;
}

export interface HintRequestFailure {
  ok: false;
  /** El estado no cambia en un rechazo; se devuelve tal cual. */
  state: HintState;
  error: HintRequestError;
  remaining: number;
}

export type HintRequestResult = HintRequestSuccess | HintRequestFailure;

/** Entrada ya revelada y resuelta al idioma pedido. */
export interface HintViewEntry extends ResolvedLocalizedEntry {
  id: string;
  puzzleId: string;
  tier: number;
  cost: number;
}

export interface HintPuzzleView {
  puzzleId: string;
  /** Último tier mostrado (`0` si aún no se pidió ninguna pista). */
  tier: number;
  /** Total de tiers definidos para el puzzle. */
  totalTiers: number;
  /** Coste del siguiente tier, o `null` si no quedan. */
  nextCost: number | null;
  /** Tiers ya revelados, en orden, con el texto resuelto. */
  hints: HintViewEntry[];
}

/** Proyección que viaja al cliente: sin textos de tiers no revelados. */
export interface HintPublicView {
  remaining: number;
  used: number;
  puzzles: HintPuzzleView[];
  /** `true` si algún puzzle aún tiene tiers por pedir. */
  hasMore: boolean;
}

/** Coste total de todas las pistas (presupuesto por defecto del contador). */
export function totalHintCost(defs: readonly HintDef[]): number {
  return defs.reduce((sum, def) => sum + def.cost, 0);
}

/** Pistas de un puzzle ordenadas por tier ascendente. */
export function hintsForPuzzle(defs: readonly HintDef[], puzzleId: string): HintDef[] {
  return defs.filter((def) => def.puzzleId === puzzleId).sort((a, b) => a.tier - b.tier);
}

/** Siguiente pista pendiente de un puzzle, o `undefined` si no queda ninguna. */
export function nextHintForPuzzle(
  state: HintState,
  defs: readonly HintDef[],
  puzzleId: string,
): HintDef | undefined {
  const currentTier = state.tierByPuzzle[puzzleId] ?? 0;
  return hintsForPuzzle(defs, puzzleId).find((hint) => hint.tier > currentTier);
}

/** Deriva el estado inicial del sistema de pistas desde la definición. */
export function createHintState(
  defs: readonly HintDef[],
  options: HintStateOptions = {},
): HintState {
  const total = options.totalHints ?? totalHintCost(defs);
  const used = options.usedHints ?? 0;
  return {
    remaining: Math.max(0, total - used),
    used: Math.max(0, used),
    tierByPuzzle: {},
    usedByPuzzle: {},
  };
}

/**
 * Pide la siguiente pista de un puzzle: devuelve el tier inmediatamente
 * superior y descuenta su `cost` del contador global de pistas restantes. Si
 * el coste supera las pistas restantes, rechaza con un error claro y no muta
 * el estado.
 */
export function requestHint(
  state: HintState,
  defs: readonly HintDef[],
  puzzleId: string,
): HintRequestResult {
  const hints = hintsForPuzzle(defs, puzzleId);
  if (hints.length === 0) {
    return reject(state, "unknown_puzzle", `No hay pistas definidas para el puzzle «${puzzleId}».`);
  }

  const currentTier = state.tierByPuzzle[puzzleId] ?? 0;
  const hint = hints.find((candidate) => candidate.tier > currentTier);
  if (!hint) {
    return reject(
      state,
      "no_more_tiers",
      `Ya has pedido todas las pistas del puzzle «${puzzleId}».`,
    );
  }

  if (hint.cost > state.remaining) {
    return reject(
      state,
      "insufficient_hints",
      `La pista de nivel ${hint.tier} cuesta ${hint.cost} y solo quedan ${state.remaining} pistas.`,
    );
  }

  const next: HintState = {
    remaining: state.remaining - hint.cost,
    used: state.used + hint.cost,
    tierByPuzzle: { ...state.tierByPuzzle, [puzzleId]: hint.tier },
    usedByPuzzle: {
      ...state.usedByPuzzle,
      [puzzleId]: (state.usedByPuzzle[puzzleId] ?? 0) + hint.cost,
    },
  };

  return {
    ok: true,
    state: next,
    hint,
    tier: hint.tier,
    cost: hint.cost,
    remaining: next.remaining,
    exhausted: !hints.some((candidate) => candidate.tier > hint.tier),
  };
}

/**
 * Proyecta el estado al cliente resolviendo los `LocalizedText` al idioma
 * pedido con fallback (specs/08 §2.2). Solo incluye los tiers ya pedidos: el
 * texto de una pista nunca se filtra antes de consumirse.
 */
export function toHintPublicView(
  state: HintState,
  defs: readonly HintDef[],
  locale: string,
  fallbackLocale: string = DEFAULT_LOCALE,
): HintPublicView {
  const puzzleIds = [...new Set(defs.map((def) => def.puzzleId))];

  const puzzles: HintPuzzleView[] = puzzleIds.map((puzzleId) => {
    const hints = hintsForPuzzle(defs, puzzleId);
    const tier = state.tierByPuzzle[puzzleId] ?? 0;
    const next = hints.find((hint) => hint.tier > tier);
    return {
      puzzleId,
      tier,
      totalTiers: hints.length,
      nextCost: next ? next.cost : null,
      hints: hints
        .filter((hint) => hint.tier <= tier)
        .map((hint) => toViewEntry(hint, locale, fallbackLocale)),
    };
  });

  return {
    remaining: state.remaining,
    used: state.used,
    puzzles,
    hasMore: puzzles.some((puzzle) => puzzle.nextCost !== null),
  };
}

function toViewEntry(hint: HintDef, locale: string, fallbackLocale: string): HintViewEntry {
  const resolved = resolveLocalizedEntry(hint.text, locale, fallbackLocale);
  return {
    ...resolved,
    id: hint.id,
    puzzleId: hint.puzzleId,
    tier: hint.tier,
    cost: hint.cost,
  };
}

function reject(state: HintState, code: HintRequestErrorCode, message: string): HintRequestFailure {
  return { ok: false, state, error: { code, message }, remaining: state.remaining };
}
