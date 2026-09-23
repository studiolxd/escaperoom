import type { Rule } from "../schemas";
import {
  applyMove,
  candidateMoves,
  doorPassable,
  ExactState,
  isNarrativeRule,
  isVictoryRule,
  objectAccessible,
  puzzleStateOf,
  RelaxedState,
  startGame,
  type ItemSource,
  type Move,
  type PuzzleOracle,
  type RoomIndex,
  type StepEffects,
} from "./model";
import type { BlockedEntry } from "./types";

/**
 * Búsquedas sobre el modelo (specs/22 §2.2 y §2.5):
 * - `relaxedClosure`: encadenamiento hacia delante hasta punto fijo, sin gastar
 *   nada (monótono). Lo que no se alcanza aquí no se alcanza jugando.
 * - `searchCriticalRoute`: BFS exacto sobre estados de juego. La primera
 *   victoria encontrada es la secuencia más corta: la **ruta crítica**.
 */

/** Cierre monótono de lo alcanzable para un tamaño de grupo. */
export function relaxedClosure(
  index: RoomIndex,
  playerCount: number,
  oracle: PuzzleOracle,
): RelaxedState {
  const state = RelaxedState.initial(index, playerCount);
  startGame(index, state);
  for (let round = 0; round < 10_000; round++) {
    const before = state.changes;
    for (const move of candidateMoves(index, state)) applyMove(index, state, move, oracle);
    if (state.changes === before) break;
  }
  return state;
}

export interface RouteNode {
  move: Move;
  effects: StepEffects;
}

export interface RouteSearchResult {
  route: RouteNode[] | null;
  explored: number;
  truncated: boolean;
}

interface SearchNode {
  state: ExactState;
  parent: SearchNode | null;
  step: RouteNode | null;
}

/** BFS exacto: ruta más corta del estado inicial a la victoria. */
export function searchCriticalRoute(
  index: RoomIndex,
  playerCount: number,
  oracle: PuzzleOracle,
  maxStates: number,
): RouteSearchResult {
  const initial = ExactState.initial(index, playerCount);
  startGame(index, initial);
  if (initial.victory) return { route: [], explored: 1, truncated: false };

  const visited = new Set<string>([initial.key()]);
  const queue: SearchNode[] = [{ state: initial, parent: null, step: null }];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!;
    for (const move of candidateMoves(index, node.state)) {
      const next = node.state.clone();
      const effects = applyMove(index, next, move, oracle);
      if (!effects) continue;
      const key = next.key();
      if (visited.has(key)) continue;
      visited.add(key);
      const child: SearchNode = { state: next, parent: node, step: { move, effects } };
      if (next.victory) return { route: unwind(child), explored: visited.size, truncated: false };
      if (next.lost) continue;
      if (visited.size >= maxStates) {
        return { route: null, explored: visited.size, truncated: true };
      }
      queue.push(child);
    }
  }
  return { route: null, explored: visited.size, truncated: false };
}

function unwind(node: SearchNode): RouteNode[] {
  const steps: RouteNode[] = [];
  for (let current: SearchNode | null = node; current?.step; current = current.parent) {
    steps.push(current.step);
  }
  return steps.reverse();
}

// ---------------------------------------------------------------------------
// Explicaciones (qué quedó bloqueado y por qué)
// ---------------------------------------------------------------------------

function describeSource(source: ItemSource): string {
  switch (source.kind) {
    case "puzzle":
      return `el puzzle «${source.id}»`;
    case "recipe":
      return `la receta ${source.id}`;
    case "rule":
      return `la regla «${source.id}»`;
    case "object":
      return `el escondite «${source.id}»`;
  }
}

/**
 * Por qué un ítem no llega nunca al inventario. Con `need` se redacta como
 * requisito: *"necesita «x», que ningún puzzle… otorga"*.
 */
export function describeMissingItem(index: RoomIndex, itemId: string, need?: string): string {
  const sources = index.itemSources.get(itemId) ?? [];
  if (need !== undefined) {
    return sources.length === 0
      ? `${need} «${itemId}», que ningún puzzle, receta, regla ni escondite otorga`
      : `${need} «${itemId}», que solo se obtiene de ${sources.map(describeSource).join(", ")} y no llega a alcanzarse`;
  }
  if (sources.length === 0) {
    return `«${itemId}» no lo otorga ningún puzzle, receta, regla ni escondite`;
  }
  return `«${itemId}» solo se obtiene de ${sources.map(describeSource).join(", ")}, que no llega a alcanzarse`;
}

/** Reglas con efectos de estado que un jugador (o la cascada) puede disparar. */
export function isGameplayRule(index: RoomIndex, rule: Rule): boolean {
  const type = rule.trigger.type;
  if (type === "on_timer_end" || type === "on_time_remaining_below" || type === "on_game_start") {
    return false;
  }
  return !isNarrativeRule(index, rule);
}

function explainRule(index: RoomIndex, state: RelaxedState, rule: Rule): string[] {
  const reasons: string[] = [];
  const trigger = rule.trigger;
  switch (trigger.type) {
    case "on_interact":
    case "on_use_item":
      if (!index.objects.has(trigger.objectId)) {
        reasons.push(`el objeto «${trigger.objectId}» no existe`);
      } else if (!objectAccessible(index, state, trigger.objectId)) {
        reasons.push(`el objeto «${trigger.objectId}» nunca es accesible`);
      }
      if (trigger.type === "on_use_item" && state.itemCount(trigger.itemId) <= 0) {
        reasons.push(describeMissingItem(index, trigger.itemId, "necesita"));
      }
      break;
    case "on_puzzle_solved":
      if (!state.isSolved(trigger.puzzleId)) {
        reasons.push(`«${trigger.puzzleId}» nunca se resuelve`);
      }
      break;
    case "on_item_collected":
      if (state.itemCount(trigger.itemId) <= 0) {
        reasons.push(describeMissingItem(index, trigger.itemId));
      }
      break;
    case "on_enter_room":
      if (!state.hasRoom(trigger.roomId)) {
        reasons.push(`la habitación «${trigger.roomId}» nunca es accesible`);
      }
      break;
    default:
      break;
  }
  for (const condition of rule.conditions) {
    switch (condition.type) {
      case "item_in_inventory":
        if (state.itemCount(condition.itemId) <= 0) {
          const text = describeMissingItem(index, condition.itemId, "necesita");
          if (!reasons.includes(text)) reasons.push(text);
        }
        break;
      case "object_state_is":
        if (!state.objectStateIs(condition.objectId, condition.state)) {
          reasons.push(`«${condition.objectId}» nunca llega al estado «${condition.state}»`);
        }
        break;
      case "flag_is":
        if (!state.flagIs(condition.flag, condition.value)) {
          reasons.push(`la flag «${condition.flag}» nunca vale ${String(condition.value)}`);
        }
        break;
      case "puzzle_state_is":
        if (puzzleStateOf(index, state, condition.puzzleId) !== condition.state) {
          if (condition.state === "solved") {
            reasons.push(`«${condition.puzzleId}» nunca se resuelve`);
          }
        }
        break;
      case "player_count_min":
        if (state.playerCount < condition.n) {
          reasons.push(`exige al menos ${condition.n} jugadores`);
        }
        break;
      case "player_count_max":
        if (state.playerCount > condition.n) {
          reasons.push(`exige como mucho ${condition.n} jugadores`);
        }
        break;
      case "time_remaining_below":
        reasons.push("depende del tiempo restante (el validador no lo simula)");
        break;
    }
  }
  if (reasons.length === 0) reasons.push("su disparador nunca llega a producirse");
  return reasons;
}

/**
 * Qué puzzles, puertas y reglas con efectos quedaron sin alcanzar en el cierre,
 * con la precondición concreta que falta (estilo de error accionable del MCP).
 */
export function explainBlocked(
  index: RoomIndex,
  state: RelaxedState,
  oracle: PuzzleOracle,
): BlockedEntry[] {
  const blocked: BlockedEntry[] = [];

  for (const puzzle of index.pkg.puzzles) {
    if (state.isSolved(puzzle.id)) continue;
    const reasons: string[] = [];
    const verdict = oracle(puzzle, state);
    if (!verdict.ok) reasons.push(...verdict.reasons);
    if (puzzle.type === "combine_items") {
      puzzle.recipes.forEach((recipe, i) => {
        if (state.isApplied(`${puzzle.id}#${i}`)) return;
        for (const itemId of recipe.inputs) {
          if (state.itemCount(itemId) <= 0) {
            reasons.push(
              describeMissingItem(
                index,
                itemId,
                `la receta ${recipe.inputs.join("+")}→${recipe.output} necesita`,
              ),
            );
          }
        }
      });
    }
    const bridge =
      puzzle.type === "simultaneous_plates" || puzzle.type === "split_clue"
        ? puzzle.soloBridgeItemId
        : undefined;
    const itemsNeeded = [
      ...(bridge !== undefined && reasons.some((reason) => reason.includes(`«${bridge}»`))
        ? [bridge]
        : []),
      ...(puzzle.type === "pipes"
        ? (puzzle.blockedCells ?? [])
            .map((cell) => cell.opensWithItem)
            .filter((itemId): itemId is string => itemId !== undefined)
        : []),
    ];
    for (const itemId of itemsNeeded) {
      if (state.itemCount(itemId) <= 0) reasons.push(describeMissingItem(index, itemId));
    }
    if (reasons.length === 0) reasons.push("ninguna combinación de pasos llega a resolverlo");
    blocked.push({ kind: "puzzle", id: puzzle.id, reasons });
  }

  for (const door of index.doors) {
    if (doorPassable(index, state, door)) continue;
    const reasons: string[] = [];
    if (door.lockedBy !== undefined) {
      reasons.push(
        index.puzzles.has(door.lockedBy)
          ? `depende de «${door.lockedBy}», que nunca se resuelve`
          : `lockedBy apunta a «${door.lockedBy}», que no existe`,
      );
    } else {
      reasons.push("ninguna regla ni puzzle que la abre llega a dispararse");
    }
    blocked.push({ kind: "door", id: door.id, reasons });
  }

  for (const rule of index.rules) {
    if (state.hasFired(rule.id) || !isGameplayRule(index, rule)) continue;
    blocked.push({ kind: "rule", id: rule.id, reasons: explainRule(index, state, rule) });
  }

  if (!index.rules.some(isVictoryRule)) {
    blocked.push({
      kind: "rule",
      id: "end_game",
      reasons: ["ninguna regla termina la partida con victoria (end_game result=victory)"],
    });
  }
  return blocked;
}
