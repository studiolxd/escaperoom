import type { PuzzleDefinition } from "../schemas";
import {
  createCodeLockState,
  createCombineItemsState,
  createHiddenKeyState,
  createMemoryState,
  createPipesState,
  createSimultaneousPlatesState,
  createSlidingState,
  createSplitClueState,
  isCombineItemsSolvable,
  isHiddenKeySolvableGiven,
  isMemorySolvable,
  isPipesSolvable,
  isSimultaneousPlatesSolvable,
  isSlidingPuzzleSolvable,
  isSolvableGiven,
  isSplitClueSolvable,
  isSplitClueSolvableForGroup,
} from "../templates";
import { objectAccessible, type ModelState, type PuzzleOracle, type RoomIndex } from "./model";

/**
 * Oráculos de solvabilidad por plantilla (specs/22 §2.3), envueltos para el
 * modelo del validador. Delegan en los oráculos de cada plantilla
 * (`isSlidingPuzzleSolvable`, `isPipesSolvable`, `isSplitClueSolvableForGroup`…)
 * sobre su estado inicial, y añaden lo que depende del resto de la sala:
 * habitación accesible, `requiresSolved`, objetos-puente del modo solitario,
 * compuertas con ítem y dígitos que revelan otras reglas.
 *
 * Los estados de plantilla se crean una vez por definición (memo): son
 * deterministas (semilla o id) y el validador solo necesita el inicial.
 */

/** RNG fijo para las plantillas que lo exigen (el oráculo no depende del orden). */
const fixedRng = (): number => 0.5;

type Verdict = { ok: true; uses: string[] } | { ok: false; reasons: string[] };

/**
 * Oráculo de la plantilla sobre su estado inicial, sin el resto de la sala
 * (habitación, `requiresSolved`, puentes). Lo usa también el configurador del
 * editor (3.5) para avisar de una configuración irresoluble al momento.
 * `heldItems`: objetos disponibles para las compuertas de `pipes`.
 */
export function isTemplateSolvable(
  puzzle: PuzzleDefinition,
  heldItems: readonly string[] = [],
): boolean {
  switch (puzzle.type) {
    case "hidden_key":
      return isHiddenKeySolvableGiven(createHiddenKeyState(puzzle), puzzle);
    case "code_lock":
      return isSolvableGiven(createCodeLockState(puzzle), puzzle);
    case "simultaneous_plates":
      return isSimultaneousPlatesSolvable(createSimultaneousPlatesState(puzzle), puzzle);
    case "combine_items":
      return isCombineItemsSolvable(createCombineItemsState(puzzle, []), puzzle);
    case "sliding_puzzle":
      return isSlidingPuzzleSolvable(createSlidingState(puzzle), puzzle);
    case "memory":
      return isMemorySolvable(createMemoryState(puzzle, fixedRng), puzzle);
    case "split_clue":
      return isSplitClueSolvable(createSplitClueState(puzzle), puzzle);
    case "pipes":
      return isPipesSolvable(createPipesState(puzzle), puzzle, { availableItems: heldItems });
  }
}

/** Motivo legible de un oráculo de plantilla en falso. */
function templateReason(puzzle: PuzzleDefinition): string {
  switch (puzzle.type) {
    case "hidden_key":
      return "el escondite no entrega ningún objeto (grantsItems y keyItemId vacíos)";
    case "code_lock":
      return `el código «${puzzle.code}» no es coherente con length=${puzzle.length}`;
    case "simultaneous_plates":
      return "las placas no son coherentes (sin placas, duplicadas o windowMs inválido)";
    case "combine_items":
      return "no tiene recetas utilizables";
    case "sliding_puzzle":
      return "la mezcla inicial no es alcanzable por movimientos válidos (paridad) o faltan datos";
    case "memory":
      return "las parejas no son coherentes (vacías, duplicadas u objetivos inexistentes)";
    case "split_clue":
      return "la unión de los puntos de vista no cubre la pista completa";
    case "pipes":
      return "no existe camino de agua de start a end (flood fill)";
  }
}

export interface OracleOptions {
  /** Reglas reveladoras requeridas por cada `code_lock` (vacío = sin pistas). */
  clueRules?: Map<string, string[]>;
}

/**
 * Construye el oráculo del modelo: `ok` con los ítems que el paso gasta
 * (objetos-puente, desde 2.11) o todos los motivos por los que aún no se
 * puede resolver.
 */
export function createOracle(index: RoomIndex, options: OracleOptions = {}): PuzzleOracle {
  const templateCache = new Map<string, boolean>();
  const cachedTemplate = (puzzle: PuzzleDefinition): boolean => {
    if (puzzle.type === "pipes") return true; // depende de los ítems: se evalúa aparte
    let value = templateCache.get(puzzle.id);
    if (value === undefined) {
      value = isTemplateSolvable(puzzle, []);
      templateCache.set(puzzle.id, value);
    }
    return value;
  };
  // Tuberías: el resultado solo depende de qué ítems de compuerta hay a mano.
  const pipesCache = new Map<string, boolean>();
  const pipesSolvable = (puzzle: PuzzleDefinition, items: readonly string[]): boolean => {
    if (puzzle.type !== "pipes") return true;
    const gateItems = [
      ...new Set(
        (puzzle.blockedCells ?? [])
          .map((cell) => cell.opensWithItem)
          .filter((itemId): itemId is string => itemId !== undefined && items.includes(itemId)),
      ),
    ].sort();
    const key = `${puzzle.id}|${gateItems.join(",")}`;
    let value = pipesCache.get(key);
    if (value === undefined) {
      value = isTemplateSolvable(puzzle, gateItems);
      pipesCache.set(key, value);
    }
    return value;
  };

  return (puzzle: PuzzleDefinition, state: ModelState): Verdict => {
    const reasons: string[] = [];
    const uses: string[] = [];

    for (const required of puzzle.requiresSolved) {
      if (!state.isSolved(required)) reasons.push(`requiere «${required}» resuelto`);
    }
    if (!state.hasRoom(puzzle.roomId)) {
      reasons.push(`su habitación «${puzzle.roomId}» no es accesible`);
    }
    if (!cachedTemplate(puzzle)) reasons.push(templateReason(puzzle));

    switch (puzzle.type) {
      case "hidden_key": {
        const objectId = puzzle.hidingSpot.objectId;
        if (objectId !== undefined && !objectAccessible(index, state, objectId)) {
          reasons.push(`el escondite «${objectId}» no es accesible`);
        }
        break;
      }
      case "code_lock": {
        for (const ruleId of options.clueRules?.get(puzzle.id) ?? []) {
          if (!state.hasFired(ruleId)) {
            reasons.push(
              `un dígito del código se revela en «${ruleId}», que aún no se ha disparado`,
            );
          }
        }
        break;
      }
      case "simultaneous_plates": {
        const missing = Math.max(0, puzzle.plates.length - state.playerCount);
        if (missing > 0) {
          const bridge = puzzle.soloBridgeItemId;
          if (bridge === undefined) {
            reasons.push(
              `necesita ${puzzle.plates.length} jugadores a la vez y no declara soloBridgeItemId`,
            );
          } else if (missing > 1) {
            // El puente se gasta al fijarse (2.11) y el inventario no admite
            // duplicados del mismo ítem (`grantItem` es idempotente): un solo
            // objeto-puente nunca puede cubrir más de una placa que falte.
            reasons.push(
              `con ${state.playerCount} jugador(es) faltan ${missing} placas y un objeto-puente consumible solo cubre 1 (el inventario no admite copias duplicadas de «${bridge}»)`,
            );
          } else if (state.itemCount(bridge) <= 0) {
            reasons.push(
              `con ${state.playerCount} jugador(es) necesita el objeto-puente «${bridge}» en el inventario`,
            );
          } else {
            // El puente se gasta al fijarse (igual que en `RoomSession`).
            uses.push(bridge);
          }
        }
        break;
      }
      case "split_clue": {
        if (!isSplitClueSolvableForGroup(puzzle, state.playerCount)) {
          reasons.push(
            puzzle.soloBridgeItemId === undefined && state.playerCount <= 1
              ? "en solitario necesita un objeto-puente y no declara soloBridgeItemId"
              : `${state.playerCount} jugador(es) no cubren todos los fragmentos`,
          );
        } else if (state.playerCount <= 1 && puzzle.soloBridgeItemId !== undefined) {
          if (state.itemCount(puzzle.soloBridgeItemId) <= 0) {
            reasons.push(
              `en solitario necesita el objeto-puente «${puzzle.soloBridgeItemId}» en el inventario`,
            );
          } else {
            uses.push(puzzle.soloBridgeItemId);
          }
        }
        break;
      }
      case "pipes": {
        const held = state.heldItems();
        if (!pipesSolvable(puzzle, held)) {
          const gates = (puzzle.blockedCells ?? []).filter(
            (cell) => cell.opensWithItem !== undefined && state.itemCount(cell.opensWithItem) <= 0,
          );
          const withGates = [...held, ...gates.map((gate) => gate.opensWithItem!)];
          if (gates.length > 0 && pipesSolvable(puzzle, withGates)) {
            for (const gate of gates) {
              reasons.push(
                `la compuerta (${gate.x},${gate.y}) necesita «${gate.opensWithItem}» en el inventario`,
              );
            }
          } else {
            reasons.push(templateReason(puzzle));
          }
        }
        break;
      }
      // `combine_items`: se aplica receta a receta; el oráculo del puzzle solo
      // exige coherencia y los ingredientes los comprueba `applyMove`.
      default:
        break;
    }

    return reasons.length === 0 ? { ok: true, uses } : { ok: false, reasons };
  };
}
