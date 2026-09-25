import type { Grid, PuzzleDefinition, RoomPackage, Rule, RuleAction, RuleCondition } from "../schemas";
import { flattenActions, puzzleGrants, type RoomIndex } from "./model";
import type { DoubleUseItem, ValidationIssue } from "./types";

/**
 * Checks estáticos del informe (sin búsqueda): integridad referencial, reglas
 * repetibles sin condición de corte, ítems de doble uso (specs/22 §2.4) y
 * objetos-puente del modo solitario (specs/22 §2.1).
 */

// ---------------------------------------------------------------------------
// Referencias
// ---------------------------------------------------------------------------

type RefKind = "room" | "object" | "puzzle" | "item" | "dialog" | "hint";

/** Entidad que una regla referencia por id (specs/05 §3). */
export type RuleReferenceKind = Exclude<RefKind, "hint">;

export interface RuleReference {
  kind: RuleReferenceKind;
  id: string;
  /** Parte de la regla donde aparece. */
  field: "trigger" | "conditions" | "actions";
  /** Ruta exacta dentro de la regla (`actions[2].actions[0].objectId`). */
  path: string;
}

/**
 * Entidad que referencia una condición de regla/diálogo (`item_in_inventory`,
 * `puzzle_state_is`, `object_state_is`), o `null` si no referencia nada
 * (`flag_is`, `player_count_min/max`, `time_remaining_below`). Lo comparten
 * `ruleReferences` (condiciones de regla) y `checkReferences`
 * (`dialog.conditions`, auditoría D-10): un diálogo condicionado a un item o
 * puzzle inexistente fallaba en silencio (nunca se mostraba).
 */
function conditionReference(
  condition: RuleCondition,
): { kind: RuleReferenceKind; id: string; field: string } | null {
  switch (condition.type) {
    case "item_in_inventory":
      return { kind: "item", id: condition.itemId, field: "itemId" };
    case "puzzle_state_is":
      return { kind: "puzzle", id: condition.puzzleId, field: "puzzleId" };
    case "object_state_is":
      return { kind: "object", id: condition.objectId, field: "objectId" };
    default:
      return null;
  }
}

/**
 * Ids de habitaciones, objetos, puzzles, items y diálogos que usa una regla,
 * en orden de aparición (trigger → condiciones → acciones, `delay` incluidos).
 * Lo comparten la integridad referencial del validador, `add_rule` del MCP
 * (4.3) y sus vistas filtradas: una sola lista de qué campo apunta a qué.
 */
export function ruleReferences(rule: Rule): RuleReference[] {
  const refs: RuleReference[] = [];
  const push = (
    kind: RuleReferenceKind,
    id: string,
    field: RuleReference["field"],
    path: string,
  ): void => {
    refs.push({ kind, id, field, path });
  };

  const trigger = rule.trigger;
  switch (trigger.type) {
    case "on_interact":
      push("object", trigger.objectId, "trigger", "trigger.objectId");
      break;
    case "on_use_item":
      push("object", trigger.objectId, "trigger", "trigger.objectId");
      push("item", trigger.itemId, "trigger", "trigger.itemId");
      break;
    case "on_enter_room":
      push("room", trigger.roomId, "trigger", "trigger.roomId");
      break;
    case "on_puzzle_solved":
      push("puzzle", trigger.puzzleId, "trigger", "trigger.puzzleId");
      break;
    case "on_item_collected":
      push("item", trigger.itemId, "trigger", "trigger.itemId");
      break;
    default:
      break;
  }

  rule.conditions.forEach((condition, i) => {
    const found = conditionReference(condition);
    if (found) push(found.kind, found.id, "conditions", `conditions[${i}].${found.field}`);
  });

  const visit = (actions: readonly RuleAction[], prefix: string): void => {
    actions.forEach((action, i) => {
      const path = `${prefix}[${i}]`;
      switch (action.type) {
        case "set_object_state":
        case "unlock_door":
        case "reveal_number":
          push("object", action.objectId, "actions", `${path}.objectId`);
          break;
        case "grant_item":
        case "consume_item":
          push("item", action.itemId, "actions", `${path}.itemId`);
          break;
        case "show_dialog":
          push("dialog", action.dialogId, "actions", `${path}.dialogId`);
          break;
        case "open_panel_puzzle":
          push("puzzle", action.puzzleId, "actions", `${path}.puzzleId`);
          break;
        case "delay":
          visit(action.actions, `${path}.actions`);
          break;
        default:
          break;
      }
    });
  };
  visit(rule.actions, "actions");
  return refs;
}

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
    for (const reference of ruleReferences(rule)) {
      ref(reference.kind, reference.id, `rules[${rule.id}].${reference.field}`);
    }
  }

  for (const hint of pkg.hints) ref("puzzle", hint.puzzleId, `hints[${hint.id}]`);

  for (const dialog of pkg.dialogs) {
    (dialog.conditions ?? []).forEach((condition, i) => {
      const found = conditionReference(condition);
      if (found) ref(found.kind, found.id, `dialogs[${dialog.id}].conditions[${i}].${found.field}`);
    });
  }
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
 * Acciones de pura presentación (diálogo, imagen, sonido, FX, panel): no
 * mutan estado del mundo/partida, así que una regla `once: false` compuesta
 * solo por estas es segura de repetir sin condición de corte a propósito
 * (p. ej. reinspeccionar una pista de conteo cuantas veces haga falta) — no
 * es el "puede repetirse sin fin" que preocupa al heurístico, que es sobre
 * acciones que acumulan o resetean estado.
 */
const PRESENTATION_ONLY_ACTIONS: ReadonlySet<RuleAction["type"]> = new Set([
  "show_dialog",
  "show_image",
  "play_sound",
  "spawn_effect",
  "open_panel_puzzle",
]);

/** `true` si la acción muta estado del mundo/partida (no es de presentación). */
function hasStateEffect(action: RuleAction): boolean {
  return !PRESENTATION_ONLY_ACTIONS.has(action.type);
}

/**
 * Reglas `once: false`: tienen condición de corte si alguna de sus condiciones
 * deja de cumplirse por efecto de sus propias acciones (estado de objeto o flag
 * que cambian, ítem que se gasta). Sin corte, pueden dispararse sin fin.
 *
 * Una regla cuyas acciones son todas de presentación (`PRESENTATION_ONLY_ACTIONS`)
 * queda fuera de este análisis: repetirla sin condición de corte es el diseño
 * buscado, no un riesgo.
 */
export function analyzeRepeatableRules(rules: readonly Rule[]): RepeatableRuleInfo[] {
  return rules
    .filter((rule) => !rule.once && flattenActions(rule.actions).some(hasStateEffect))
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
 * condición `consumed`, `consume_item` o un objeto-puente, que desde 2.11 se
 * gasta al fijarse igual que cualquier otro ítem de un solo uso). La llave de
 * una compuerta de `pipes` sigue sin gastarse.
 * Hay conflicto si la oferta (fuentes) no cubre la demanda y ninguna regla
 * repetible lo devuelve.
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

// ---------------------------------------------------------------------------
// Modo solitario (objetos-puente)
// ---------------------------------------------------------------------------

/**
 * Qué exige más de un jugador en una mecánica cooperativa, o `null` si el
 * puzzle no es cooperativo. Coherente con los oráculos: unas placas con una
 * sola placa las pisa un jugador; una pista dividida siempre pide el puente en
 * solitario (`isSplitClueSolvableForGroup`).
 */
export function cooperativeRequirement(puzzle: PuzzleDefinition): string | null {
  switch (puzzle.type) {
    case "simultaneous_plates":
      return puzzle.plates.length >= 2 ? `pisar ${puzzle.plates.length} placas a la vez` : null;
    case "split_clue":
      return `ver la pista repartida entre ${puzzle.viewpoints.length} punto(s) de vista`;
    default:
      return null;
  }
}

/**
 * Mecánicas cooperativas sin `soloBridgeItemId` en una sala que se evalúa con
 * 1 jugador (`players.min = 1`). Es un error independiente de la búsqueda: el
 * puzzle no se puede resolver en solitario aunque la victoria llegue por otro
 * camino o el puzzle aún no sea alcanzable.
 */
export function checkSoloBridges(pkg: RoomPackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const puzzle of pkg.puzzles) {
    const requirement = cooperativeRequirement(puzzle);
    if (requirement === null) continue;
    if ("soloBridgeItemId" in puzzle && puzzle.soloBridgeItemId !== undefined) continue;
    issues.push({
      code: "solo_bridge_missing",
      message: `«${puzzle.id}» (${puzzle.type}) es cooperativo: exige ${requirement} y no declara soloBridgeItemId, así que no se puede resolver con 1 jugador. Añade un objeto-puente (soloBridgeItemId) o sube players.min a 2`,
      ids: [puzzle.id],
      playerCounts: [1],
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Geometría (auditoría D-3): posiciones fuera de la rejilla de su habitación
// ---------------------------------------------------------------------------

function inGrid(grid: Grid, x: number, y: number, w = 0, h = 0): boolean {
  return x >= 0 && y >= 0 && x + w <= grid.cols && y + h <= grid.rows;
}

/**
 * Toda posición (objetos, `spawnPoints`, decoraciones, antorchas, `hidingSpot`,
 * placas, `viewpoints.zone`, `puzzle.position`) debe caer dentro de la rejilla
 * de su habitación. Encoger una habitación en el editor podía dejar objetos
 * "fuera" que el runtime (`toRuntimeModel`) rechazaba solo al publicar
 * (auditoría D-3): este check lo detecta antes, en el informe de validación.
 */
export function checkGeometry(pkg: RoomPackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const grids = new Map(pkg.map.rooms.map((room) => [room.id, room.grid]));

  const at = (roomId: string, x: number, y: number, label: string, id: string): void => {
    const grid = grids.get(roomId);
    // Habitación inexistente: ya lo reporta checkReferences.
    if (!grid) return;
    if (!inGrid(grid, x, y)) {
      issues.push({
        code: "out_of_bounds",
        message: `${label} en (${x}, ${y}) queda fuera de la rejilla de «${roomId}» (${grid.cols}×${grid.rows})`,
        ids: [id],
      });
    }
  };

  for (const room of pkg.map.rooms) {
    for (const spawn of room.spawnPoints) {
      at(room.id, spawn.x, spawn.y, `el spawnPoint «${spawn.id}»`, spawn.id);
    }
    for (const decoration of room.decorations) {
      at(room.id, decoration.x, decoration.y, `la decoración «${decoration.sprite}»`, decoration.sprite);
    }
    for (const light of room.lighting) {
      if (light.type === "torch") {
        at(room.id, light.x, light.y, "la antorcha", light.objectId ?? `${room.id}:torch`);
      }
    }
  }

  for (const object of pkg.objects) {
    at(object.roomId, object.position.x, object.position.y, `el objeto «${object.id}»`, object.id);
    for (const cell of object.footprint ?? []) {
      at(object.roomId, cell.x, cell.y, `la huella del objeto «${object.id}»`, object.id);
    }
  }

  for (const puzzle of pkg.puzzles) {
    if (puzzle.position) {
      at(puzzle.roomId, puzzle.position.x, puzzle.position.y, `el puzzle «${puzzle.id}»`, puzzle.id);
    }
    switch (puzzle.type) {
      case "hidden_key":
        if (puzzle.hidingSpot.x !== undefined && puzzle.hidingSpot.y !== undefined) {
          at(puzzle.roomId, puzzle.hidingSpot.x, puzzle.hidingSpot.y, `el escondite de «${puzzle.id}»`, puzzle.id);
        }
        break;
      case "simultaneous_plates":
        for (const plate of puzzle.plates) {
          at(puzzle.roomId, plate.x, plate.y, `una placa de «${puzzle.id}»`, puzzle.id);
        }
        break;
      case "split_clue": {
        const grid = grids.get(puzzle.roomId);
        if (grid) {
          for (const viewpoint of puzzle.viewpoints) {
            const zone = viewpoint.zone;
            if (!inGrid(grid, zone.x, zone.y, zone.w, zone.h)) {
              issues.push({
                code: "out_of_bounds",
                message: `el punto de vista de «${puzzle.id}» (zona ${zone.x},${zone.y} ${zone.w}×${zone.h}) queda fuera de la rejilla de «${puzzle.roomId}» (${grid.cols}×${grid.rows})`,
                ids: [puzzle.id],
              });
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Invariantes estructurales (auditoría D-10): checks que faltaban del informe
// ---------------------------------------------------------------------------

/**
 * Invariantes que no dependen de la búsqueda ni del BFS: idioma por defecto
 * declarado, rango de jugadores coherente, estado inicial existente, cupo de
 * puntos de aparición y longitud del código de un `code_lock`. Antes solo
 * `create_room` (MCP) validaba `players.min ≤ max`, y el resto ni se
 * comprobaba (fallaban en silencio en el loader o el runtime).
 */
export function checkStructuralInvariants(pkg: RoomPackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!pkg.meta.languages.includes(pkg.meta.defaultLanguage)) {
    issues.push({
      code: "default_language_not_declared",
      message: `defaultLanguage «${pkg.meta.defaultLanguage}» no está en languages [${pkg.meta.languages.join(", ")}]`,
      ids: [],
    });
  }
  if (pkg.meta.players.min > pkg.meta.players.max) {
    issues.push({
      code: "players_range_invalid",
      message: `players.min (${pkg.meta.players.min}) es mayor que players.max (${pkg.meta.players.max})`,
      ids: [],
    });
  }

  for (const object of pkg.objects) {
    // `states: {}` + `initialState: ""` es el sentinel de "sin máquina de
    // estados" (objetos puramente decorativos, p. ej. `vasijas` en el fixture
    // Rey Aldric): solo es un error si el objeto SÍ declara estados.
    const hasStates = Object.keys(object.states).length > 0;
    if (hasStates && !(object.initialState in object.states)) {
      issues.push({
        code: "unknown_initial_state",
        message: `«${object.id}».initialState «${object.initialState}» no está entre sus estados declarados: [${Object.keys(object.states).join(", ")}]`,
        ids: [object.id],
      });
    }
  }

  for (const puzzle of pkg.puzzles) {
    if (puzzle.type === "memory") {
      const symbols = new Map<string, number>();
      for (const pair of puzzle.pairs) symbols.set(pair.symbol, (symbols.get(pair.symbol) ?? 0) + 1);
      for (const [symbol, count] of symbols) {
        if (count > 1) {
          issues.push({
            code: "duplicate_memory_symbol",
            message: `«${puzzle.id}»: el símbolo «${symbol}» se repite en ${count} parejas; cada pareja necesita un símbolo único`,
            ids: [puzzle.id],
          });
        }
      }
    }
    if (puzzle.type === "code_lock" && puzzle.code.length !== puzzle.length) {
      issues.push({
        code: "code_length_mismatch",
        message: `«${puzzle.id}»: code tiene ${puzzle.code.length} caracteres pero length declara ${puzzle.length}`,
        ids: [puzzle.id],
      });
    }
  }

  return issues;
}

/**
 * Cupo de `spawnPoints` por habitación (auditoría D-10, specs/08 §2.1): con
 * menos puntos de aparición que `players.max`, `spawnPlayer`/`handleRoomChange`
 * reparten jugadores por índice `% spawnPoints.length` y varios acaban en la
 * misma casilla. No bloquea la partida (por eso es un check aparte, no un
 * invariante estructural duro), pero avisa al creador.
 */
export function checkSpawnCapacity(pkg: RoomPackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const room of pkg.map.rooms) {
    if (room.spawnPoints.length < pkg.meta.players.max) {
      issues.push({
        code: "not_enough_spawn_points",
        message: `«${room.id}» tiene ${room.spawnPoints.length} spawnPoint(s) pero players.max es ${pkg.meta.players.max}: varios jugadores aparecerían en la misma casilla`,
        ids: [room.id],
      });
    }
  }
  return issues;
}
