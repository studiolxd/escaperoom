import type { HintPublicView } from "@escaperoom/shared/hints";
import type { SessionResult, SessionSummary } from "@escaperoom/shared/session";
import type { RuntimeHint } from "../loader";
import { AVATAR_MOVE_EMIT_MS, GAME_MAX_STEP_CELLS } from "./protocol";
import type { GameEndStats, GameSnapshot } from "./types";

/**
 * Proyecciones puras que la UI de red necesita y el protocolo no manda tal
 * cual: la vista de pistas (el servidor solo entrega `hint_delivered`), el
 * resumen de fin (`game_ended`) y el troceo de un desplazamiento en pasos que
 * el servidor acepte.
 */

/** Pista ya entregada por el servidor al jugador local. */
export interface DeliveredHint {
  puzzleId: string;
  tier: number;
  text: string;
}

/**
 * `HintPublicView` a partir de las pistas declaradas (sin texto) y las que el
 * servidor ya entregó a este jugador. El contador es el del presupuesto total
 * menos lo entregado aquí (el servidor lo lleva por partida y es quien decide).
 */
export function buildHintView(
  hints: readonly RuntimeHint[],
  delivered: readonly DeliveredHint[],
  locale: string,
): HintPublicView {
  const puzzleIds = [...new Set(hints.map((hint) => hint.puzzleId))];
  let used = 0;
  const puzzles = puzzleIds.map((puzzleId) => {
    const tiers = hints
      .filter((hint) => hint.puzzleId === puzzleId)
      .sort((a, b) => a.tier - b.tier);
    const seen = delivered
      .filter((hint) => hint.puzzleId === puzzleId)
      .sort((a, b) => a.tier - b.tier);
    const tier = seen.at(-1)?.tier ?? 0;
    for (const hint of seen) used += tiers.find((def) => def.tier === hint.tier)?.cost ?? 0;
    const next = tiers.find((def) => def.tier > tier);
    return {
      puzzleId,
      tier,
      totalTiers: tiers.length,
      nextCost: next ? next.cost : null,
      hints: seen.map((hint) => ({
        id: `${puzzleId}#${hint.tier}`,
        puzzleId,
        tier: hint.tier,
        cost: tiers.find((def) => def.tier === hint.tier)?.cost ?? 0,
        locale,
        text: hint.text,
      })),
    };
  });
  const total = hints.reduce((sum, hint) => sum + hint.cost, 0);
  return {
    remaining: Math.max(0, total - used),
    used,
    puzzles,
    hasMore: puzzles.some((puzzle) => puzzle.nextCost !== null),
  };
}

/** `SessionSummary` para la pantalla de resultados a partir de `game_ended`. */
export function toSessionSummary(
  result: string,
  stats: GameEndStats | null,
  snapshot: GameSnapshot,
): SessionSummary {
  const solvedPuzzles = Object.entries(snapshot.puzzles)
    .filter(([, puzzle]) => puzzle.state === "solved")
    .map(([id]) => id);
  const items = [...new Set(Object.values(snapshot.inventories).flat())];
  return {
    result: toResult(result),
    endedAt: snapshot.clock,
    stats: stats ?? {
      durationSec: Math.max(0, Math.round((snapshot.clock - snapshot.startedAt) / 1000)),
      hintsUsed: 0,
      puzzlesSolved: solvedPuzzles.length,
      puzzlesTotal: Object.keys(snapshot.puzzles).length,
      itemsCollected: items.length,
    },
    solvedPuzzles,
    items,
  };
}

function toResult(result: string): SessionResult {
  return result === "victory" || result === "timeout" ? result : "aborted";
}

/**
 * Trocea el desplazamiento `from → to` en posiciones intermedias separadas
 * como mucho `maxStep` celdas (por debajo del salto máximo del servidor).
 */
export function stepsBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
  maxStep = GAME_MAX_STEP_CELLS - 0.5,
): Array<{ x: number; y: number }> {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance === 0) return [];
  const count = Math.max(1, Math.ceil(distance / maxStep));
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 1) / count;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  });
}

/**
 * F-23: manda los pasos de `stepsBetween` al ritmo máximo permitido
 * (`AVATAR_MOVE_EMIT_MS`, el mismo límite de `move` del servidor —10/s—) en
 * vez de todos de golpe. Antes (`walkTo` en `game-session-shell.tsx`) un
 * bucle síncrono mandaba cada paso sin esperar, disparando `RATE_LIMITED` en
 * cuanto había más de un puñado de pasos, y el avatar se colocaba en el
 * destino final antes de que el servidor aceptara los intermedios (el
 * "rebote"). `schedule` es inyectable para poder probarlo sin temporizadores
 * reales; por defecto usa `setTimeout`.
 */
export function walkSteps(
  steps: ReadonlyArray<{ x: number; y: number }>,
  emit: (step: { x: number; y: number }) => void,
  options: {
    intervalMs?: number;
    schedule?: (callback: () => void, ms: number) => unknown;
    /**
     * Se llama cuando se ha mandado el último paso (o de inmediato si no
     * hay ninguno) — nunca si `cancel()` corta la caminata antes de llegar
     * (p. ej. `enterRoom` en `game-session-shell.tsx` solo manda el `move`
     * de cruce de habitación cuando el avatar ha llegado de verdad).
     */
    onDone?: () => void;
  } = {},
): { cancel: () => void } {
  const intervalMs = options.intervalMs ?? AVATAR_MOVE_EMIT_MS;
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
  let cancelled = false;
  let index = 0;
  const finish = () => {
    if (!cancelled) options.onDone?.();
  };
  const cancel = () => {
    cancelled = true;
  };
  if (steps.length === 0) {
    finish();
    return { cancel };
  }
  const sendNext = () => {
    if (cancelled || index >= steps.length) return;
    emit(steps[index]!);
    index += 1;
    if (index < steps.length) schedule(sendNext, intervalMs);
    else finish();
  };
  sendNext();
  return { cancel };
}
