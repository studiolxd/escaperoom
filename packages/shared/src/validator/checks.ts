import type { RoomPackage, Rule } from "../schemas";
import { flattenActions, puzzleGrants, type RoomIndex } from "./model";
import type { DoubleUseItem, ValidationIssue } from "./types";

/**
 * Checks estáticos del informe (sin búsqueda): integridad referencial, reglas
 * repetibles sin condición de corte e ítems de doble uso (specs/22 §2.4).
 */

// ---------------------------------------------------------------------------
// Referencias
// ---------------------------------------------------------------------------

type RefKind = "room" | "object" | "puzzle" | "item" | "dialog" | "hint";

const REF_LABEL: Record<RefKind, string> = {
  room: "la habitación",
  object: "el objeto",
  puzzle: "el puzzle",
  item: "el item",
  dialog: "el diálogo",
  hint: "la pista",
};

/** Lista corta de disponibles para el mensaje accionable. */
function available(ids: Iterable<string>): string {
  const list = [...ids].sort();
  const shown = list.slice(0, 8);
  return `[${shown.join(", ")}${list.length > shown.length ? ", …" : ""}]`;
}

/**
 * Integridad referencial: todo id referenciado existe y no hay ids duplicados.
 * Mismo estilo que los errores del MCP: *"el objeto 'x' no existe.
 * Disponibles: [...]"*.
 */
export function checkReferences(pkg: RoomPackage): ValidationIssue[] {
  const known: Record<RefKind, Set<string>> = {
    room: new Set(pkg.map.rooms.map((room) => room.id)),
    object: new Set(pkg.objects.map((object) => object.id)),
    puzzle: new Set(pkg.puzzles.map((puzzle) => puzzle.id)),
    item: new Set(pkg.items.map((item) => item.id)),
    dialog: new Set(pkg.dialogs.map((dialog) => dialog.id)),
    hint: new Set(pkg.hints.map((hint) => hint.id)),
  };
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  const ref = (kind: RefKind, id: string | undefined, where: string): void => {
    if (id === undefined || known[kind].has(id)) return;
    const key = `${kind}|${id}|${where}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({
      code: `unknown_${kind}`,
      message: `${REF_LABEL[kind]} «${id}» (en ${where}) no existe. Disponibles: ${available(known[kind])}`,
      ids: [id],
    });
  };

  const duplicates = (kind: string, ids: string[]): void => {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      if (count > 1) {
        issues.push({
          code: "duplicate_id",
          message: `id duplicado «${id}» en ${kind} (${count} veces)`,
          ids: [id],
        });
      }
    }
  };
  duplicates(
    "map.rooms",
    pkg.map.rooms.map((room) => room.id),
  );
  duplicates(
    "objects",
    pkg.objects.map((object) => object.id),
  );
  duplicates(
    "items",
    pkg.items.map((item) => item.id),
  );
  duplicates(
    "puzzles",
    pkg.puzzles.map((puzzle) => puzzle.id),
  );
  duplicates(
    "rules",
    pkg.rules.map((rule) => rule.id),
  );
  duplicates(
    "dialogs",
    pkg.dialogs.map((dialog) => dialog.id),
  );
  duplicates(
    "hints",
    pkg.hints.map((hint) => hint.id),
  );

  for (const room of pkg.map.rooms) {
    for (const light of room.lighting) {
      if (light.type === "torch") ref("object", light.objectId, `map.rooms[${room.id}].lighting`);
    }
  }

  for (const object of pkg.objects) {
    const where = `objects[${object.id}]`;
    ref("room", object.roomId, where);
    ref("puzzle", object.lockedBy, `${where}.lockedBy`);
    ref("room", object.leadsTo, `${where}.leadsTo`);
    ref("item", object.hidingSpot?.contains, `${where}.hidingSpot`);
    for (const itemId of object.inventory ?? []) ref("item", itemId, `${where}.inventory`);
  }

  for (const puzzle of pkg.puzzles) {
    const where = `puzzles[${puzzle.id}]`;
    ref("room", puzzle.roomId, where);
    for (const id of puzzle.requiresSolved) ref("puzzle", id, `${where}.requiresSolved`);
    for (const id of puzzleGrants(puzzle)) ref("item", id, `${where}.grantsItems`);
    for (const id of puzzle.unlocks) ref("object", id, `${where}.unlocks`);
    switch (puzzle.type) {
      case "hidden_key":
        ref("object", puzzle.hidingSpot.objectId, `${where}.hidingSpot`);
        break;
      case "code_lock":
        for (const id of puzzle.hints ?? []) ref("hint", id, `${where}.hints`);
        break;
      case "simultaneous_plates":
        for (const plate of puzzle.plates) ref("object", plate.objectId, `${where}.plates`);
        ref("item", puzzle.soloBridgeItemId, `${where}.soloBridgeItemId`);
        break;
      case "combine_items":
        for (const recipe of puzzle.recipes) {
          for (const id of recipe.inputs) ref("item", id, `${where}.recipes`);
          ref("item", recipe.output, `${where}.recipes`);
        }
        break;
      case "split_clue":
        for (const viewpoint of puzzle.viewpoints) {
          ref("object", viewpoint.objectId, `${where}.viewpoints`);
        }
        ref("item", puzzle.soloBridgeItemId, `${where}.soloBridgeItemId`);
        break;
      case "pipes":
        for (const cell of puzzle.blockedCells ?? []) {
          ref("item", cell.opensWithItem, `${where}.blockedCells`);
        }
        break;
      default:
        break;
    }
  }

  for (const rule of pkg.rules) {
    const where = `rules[${rule.id}]`;
    const trigger = rule.trigger;
    switch (trigger.type) {
      case "on_interact":
        ref("object", trigger.objectId, `${where}.trigger`);
        break;
      case "on_use_item":
        ref("object", trigger.objectId, `${where}.trigger`);
        ref("item", trigger.itemId, `${where}.trigger`);
        break;
      case "on_enter_room":
        ref("room", trigger.roomId, `${where}.trigger`);
        break;
      case "on_puzzle_solved":
        ref("puzzle", trigger.puzzleId, `${where}.trigger`);
        break;
      case "on_item_collected":
        ref("item", trigger.itemId, `${where}.trigger`);
        break;
      default:
        break;
    }
    for (const condition of rule.conditions) {
      if (condition.type === "item_in_inventory") {
        ref("item", condition.itemId, `${where}.conditions`);
      }
      if (condition.type === "puzzle_state_is") {
        ref("puzzle", condition.puzzleId, `${where}.conditions`);
      }
      if (condition.type === "object_state_is") {
        ref("object", condition.objectId, `${where}.conditions`);
      }
    }
    for (const action of flattenActions(rule.actions)) {
      switch (action.type) {
        case "set_object_state":
        case "unlock_door":
        case "reveal_number":
          ref("object", action.objectId, `${where}.actions`);
          break;
        case "grant_item":
        case "consume_item":
          ref("item", action.itemId, `${where}.actions`);
          break;
        case "show_dialog":
          ref("dialog", action.dialogId, `${where}.actions`);
          break;
        case "open_panel_puzzle":
          ref("puzzle", action.puzzleId, `${where}.actions`);
          break;
        default:
          break;
      }
    }
  }

  for (const hint of pkg.hints) ref("puzzle", hint.puzzleId, `hints[${hint.id}]`);
  return issues;
}

// ---------------------------------------------------------------------------
// Reglas repetibles
// ---------------------------------------------------------------------------

export interface RepeatableRuleInfo {
  ruleId: string;
  guards: number;
  /** Condiciones que la propia regla invalida al disparar. */
  cutConditions: number;
}

/**
 * Reglas `once: false`: tienen condición de corte si alguna de sus condiciones
 * deja de cumplirse por efecto de sus propias acciones (estado de objeto o flag
 * que cambian, ítem que se gasta). Sin corte, pueden dispararse sin fin.
 */
export function analyzeRepeatableRules(rules: readonly Rule[]): RepeatableRuleInfo[] {
  return rules
    .filter((rule) => !rule.once)
    .map((rule) => {
      const actions = flattenActions(rule.actions);
      const cutConditions = rule.conditions.filter((condition) => {
        switch (condition.type) {
          case "object_state_is":
            return actions.some(
              (action) =>
                action.type === "set_object_state" &&
                action.objectId === condition.objectId &&
                action.state !== condition.state,
            );
          case "flag_is":
            return actions.some(
              (action) =>
                action.type === "set_flag" &&
                action.flag === condition.flag &&
                action.value !== condition.value,
            );
          case "item_in_inventory":
            return (
              condition.consumed === true ||
              actions.some(
                (action) => action.type === "consume_item" && action.itemId === condition.itemId,
              )
            );
          default:
            return false;
        }
      }).length;
      return { ruleId: rule.id, guards: rule.conditions.length, cutConditions };
    });
}

export function guardLabel(guards: number): string {
  switch (guards) {
    case 1:
      return "guarda simple";
    case 2:
      return "guarda doble";
    case 3:
      return "guarda triple";
    default:
      return `${guards} guardas`;
  }
}

// ---------------------------------------------------------------------------
// Doble uso
// ---------------------------------------------------------------------------

/**
 * Ítems con más de un uso donde alguno los gasta (receta con `consumeInputs`,
 * condición `consumed`, `consume_item` u objeto-puente que queda colocado).
 * Hay conflicto si la oferta (fuentes) no cubre la demanda y ninguna regla
 * repetible lo devuelve — el caso del cáliz del Rey Aldric está resuelto por
 * `r-recoger-caliz`.
 */
export function analyzeDoubleUse(index: RoomIndex): DoubleUseItem[] {
  const uses = new Map<string, { label: string; consuming: boolean }[]>();
  const add = (itemId: string, label: string, consuming: boolean): void => {
    const list = uses.get(itemId) ?? [];
    const existing = list.find((use) => use.label === label);
    if (existing) existing.consuming ||= consuming;
    else list.push({ label, consuming });
    uses.set(itemId, list);
  };

  for (const puzzle of index.pkg.puzzles) {
    switch (puzzle.type) {
      case "combine_items":
        for (const recipe of puzzle.recipes) {
          for (const itemId of recipe.inputs) {
            add(itemId, `receta ${recipe.inputs.join("+")}→${recipe.output}`, recipe.consumeInputs);
          }
        }
        break;
      case "simultaneous_plates":
      case "split_clue":
        if (puzzle.soloBridgeItemId !== undefined) {
          add(puzzle.soloBridgeItemId, `puente de ${puzzle.id}`, true);
        }
        break;
      case "pipes":
        for (const cell of puzzle.blockedCells ?? []) {
          if (cell.opensWithItem !== undefined) {
            add(cell.opensWithItem, `compuerta de ${puzzle.id}`, false);
          }
        }
        break;
      default:
        break;
    }
  }

  for (const rule of index.rules) {
    const label = `regla ${rule.id}`;
    if (rule.trigger.type === "on_use_item") add(rule.trigger.itemId, label, false);
    for (const condition of rule.conditions) {
      if (condition.type === "item_in_inventory") {
        add(condition.itemId, label, condition.consumed === true);
      }
    }
    for (const action of flattenActions(rule.actions)) {
      if (action.type === "consume_item") add(action.itemId, label, true);
    }
  }

  const result: DoubleUseItem[] = [];
  for (const [itemId, list] of uses) {
    const consuming = list.filter((use) => use.consuming);
    if (list.length < 2 || consuming.length === 0) continue;
    const sources = index.itemSources.get(itemId) ?? [];
    const recovery = sources.find((source) => source.kind === "rule" && source.repeatable);
    const demand = consuming.length + (list.length > consuming.length ? 1 : 0);
    result.push({
      itemId,
      uses: list.map((use) => use.label),
      consumingUses: consuming.map((use) => use.label),
      resolvedBy: recovery?.id ?? null,
      conflict: recovery === undefined && sources.length < demand,
    });
  }
  return result;
}
