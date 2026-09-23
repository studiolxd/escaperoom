import type { PuzzleDefinition, Rule, RuleAction } from "@escaperoom/shared/schemas";

/**
 * Mapa semántico de referencias entre ids del RoomPackage (specs/08 §2,
 * specs/06 §1, specs/05 §3). Es la fuente única que usan:
 *
 * - el **renombrado** (`rename.ts`): reescribe exactamente estos campos y nada
 *   más. Un texto igual al id en otro sitio (el sprite `trono` del objeto
 *   `trono`, un fragmento de `split_clue`…) NO es una referencia y no se toca;
 * - «reglas que lo tocan» (`findRulesTouching`);
 * - el formulario: un campo con `ref` ofrece los ids existentes de ese tipo.
 */

/** Tipo de elemento al que apunta un id. `state` = uno de los estados del propio objeto. */
export type RefKind = "object" | "puzzle" | "item" | "room" | "hint" | "dialog" | "state";

/**
 * Ruta dentro de un valor JSON. `*` recorre todos los elementos de un array (o
 * valores de un record); `@key` es la CLAVE de un record (p. ej. las claves de
 * `visibleByViewpoint` son ids de objeto).
 */
export type RefPath = readonly string[];

export type RefSpec = { path: RefPath; kind: RefKind };

/** Referencias de un `WorldObject` (specs/04 §3.1). */
export const OBJECT_REFS: readonly RefSpec[] = [
  { path: ["roomId"], kind: "room" },
  { path: ["initialState"], kind: "state" },
  { path: ["inventory", "*"], kind: "item" },
  { path: ["lockedBy"], kind: "puzzle" },
  { path: ["hidingSpot", "contains"], kind: "item" },
  { path: ["leadsTo"], kind: "room" },
];

/** Campos comunes de toda plantilla (specs/06 §1). */
export const PUZZLE_BASE_REFS: readonly RefSpec[] = [
  { path: ["roomId"], kind: "room" },
  { path: ["requiresSolved", "*"], kind: "puzzle" },
  { path: ["grantsItems", "*"], kind: "item" },
  { path: ["unlocks", "*"], kind: "object" },
];

/** Campos propios de cada plantilla (su configuración es 3.5; el renombrado los necesita ya). */
export const PUZZLE_TYPE_REFS: Record<PuzzleDefinition["type"], readonly RefSpec[]> = {
  hidden_key: [
    { path: ["hidingSpot", "objectId"], kind: "object" },
    { path: ["keyItemId"], kind: "item" },
  ],
  code_lock: [{ path: ["hints", "*"], kind: "hint" }],
  simultaneous_plates: [
    { path: ["plates", "*", "objectId"], kind: "object" },
    { path: ["soloBridgeItemId"], kind: "item" },
  ],
  combine_items: [
    { path: ["recipes", "*", "inputs", "*"], kind: "item" },
    { path: ["recipes", "*", "output"], kind: "item" },
  ],
  sliding_puzzle: [],
  memory: [],
  split_clue: [
    { path: ["viewpoints", "*", "objectId"], kind: "object" },
    { path: ["visibleByViewpoint", "@key"], kind: "object" },
    { path: ["soloBridgeItemId"], kind: "item" },
  ],
  pipes: [{ path: ["blockedCells", "*", "opensWithItem"], kind: "item" }],
};

export function puzzleRefs(type: string | undefined): readonly RefSpec[] {
  const own =
    type && type in PUZZLE_TYPE_REFS ? PUZZLE_TYPE_REFS[type as PuzzleDefinition["type"]] : [];
  return [...PUZZLE_BASE_REFS, ...own];
}

/**
 * En el vocabulario de reglas (triggers, condiciones, acciones) las
 * referencias van siempre en campos con estos nombres; `delay` anida acciones.
 */
export const RULE_FIELD_REFS: Readonly<Record<string, RefKind>> = {
  objectId: "object",
  puzzleId: "puzzle",
  itemId: "item",
  roomId: "room",
  dialogId: "dialog",
};

/** Referencias de las piezas de una regla (trigger, condición o acción, con `delay` anidado). */
export function ruleNodeRefs(node: unknown): RefSpec[] {
  if (!node || typeof node !== "object") return [];
  const specs: RefSpec[] = [];
  for (const key of Object.keys(node)) {
    const kind = RULE_FIELD_REFS[key];
    if (kind) specs.push({ path: [key], kind });
  }
  const nested = (node as { type?: string; actions?: unknown }).actions;
  if ((node as { type?: string }).type === "delay" && Array.isArray(nested)) {
    nested.forEach((child, i) => {
      for (const spec of ruleNodeRefs(child)) {
        specs.push({ path: ["actions", String(i), ...spec.path], kind: spec.kind });
      }
    });
  }
  return specs;
}

/** Referencias de una pista (specs/08 §2.3). */
export const HINT_REFS: readonly RefSpec[] = [{ path: ["puzzleId"], kind: "puzzle" }];

/** Referencias de una luz de una habitación (antorcha ligada a un objeto, specs/04 §3.4). */
export const LIGHT_REFS: readonly RefSpec[] = [{ path: ["objectId"], kind: "object" }];

// ---------------------------------------------------------------------------
// Recorrido y reescritura de valores JSON
// ---------------------------------------------------------------------------

type Json = unknown;

/** Valores que hay en `path` (con `*`), en orden. `@key` devuelve las claves. */
export function valuesAt(value: Json, path: RefPath): unknown[] {
  if (path.length === 0) return [value];
  const [head, ...rest] = path;
  if (value === null || typeof value !== "object") return [];
  if (head === "@key") return Object.keys(value);
  if (head === "*") {
    const children = Array.isArray(value) ? value : Object.values(value);
    return children.flatMap((child) => valuesAt(child, rest));
  }
  return valuesAt((value as Record<string, unknown>)[head as string], rest);
}

/** ¿`value` referencia al id `id` de tipo `kind` según `specs`? */
export function referencesId(
  value: Json,
  specs: readonly RefSpec[],
  kind: RefKind,
  id: string,
): boolean {
  return specs.some((spec) => spec.kind === kind && valuesAt(value, spec.path).includes(id));
}

/**
 * Copia de `value` con cada referencia `kind: from` sustituida por `to`, o el
 * mismo objeto si no había ninguna (para no escribir en el doc sin cambios).
 */
export function rewriteRefs<T>(
  value: T,
  specs: readonly RefSpec[],
  kind: RefKind,
  from: string,
  to: string,
): T {
  let result: unknown = value;
  for (const spec of specs) {
    if (spec.kind === kind) result = rewriteAt(result, spec.path, from, to);
  }
  return result as T;
}

function rewriteAt(value: unknown, path: RefPath, from: string, to: string): unknown {
  if (path.length === 0) return value === from ? to : value;
  if (value === null || typeof value !== "object") return value;
  const [head, ...rest] = path;
  if (head === "@key") {
    const record = value as Record<string, unknown>;
    if (!(from in record) || to in record) return value;
    // Conserva el orden de las claves.
    return Object.fromEntries(
      Object.entries(record).map(([key, v]) => [key === from ? to : key, v]),
    );
  }
  if (head === "*") {
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((child) => {
        const out = rewriteAt(child, rest, from, to);
        if (out !== child) changed = true;
        return out;
      });
      return changed ? next : value;
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] = rewriteAt(child, rest, from, to);
      if (next[key] !== child) changed = true;
    }
    return changed ? next : value;
  }
  const record = value as Record<string, unknown>;
  const key = head as string;
  if (Array.isArray(value)) {
    const index = Number(key);
    const child = value[index];
    const out = rewriteAt(child, rest, from, to);
    if (out === child) return value;
    const next = [...value];
    next[index] = out;
    return next;
  }
  if (!(key in record)) return value;
  const out = rewriteAt(record[key], rest, from, to);
  return out === record[key] ? value : { ...record, [key]: out };
}

// ---------------------------------------------------------------------------
// Reglas que tocan un elemento
// ---------------------------------------------------------------------------

/** Dónde toca una regla al elemento: su trigger, condiciones o acciones (por índice). */
export type RuleTouch = {
  ruleId: string;
  trigger: boolean;
  conditions: number[];
  actions: number[];
};

/**
 * Reglas que referencian `kind:id` (specs/09 §3: «reglas que lo tocan»), en el
 * orden de `rules`. Para `state` no aplica (los estados son del objeto).
 */
export function findRulesTouching(rules: readonly Rule[], kind: RefKind, id: string): RuleTouch[] {
  const touches: RuleTouch[] = [];
  const hits = (node: unknown) => referencesId(node, ruleNodeRefs(node), kind, id);
  for (const rule of rules) {
    const touch: RuleTouch = {
      ruleId: rule.id,
      trigger: hits(rule.trigger),
      conditions: rule.conditions.flatMap((c, i) => (hits(c) ? [i] : [])),
      actions: rule.actions.flatMap((a: RuleAction, i) => (hits(a) ? [i] : [])),
    };
    if (touch.trigger || touch.conditions.length > 0 || touch.actions.length > 0) {
      touches.push(touch);
    }
  }
  return touches;
}

/** Diálogos que muestra una lista de acciones (incluidas las de un `delay`). */
export function dialogsShownBy(actions: readonly RuleAction[]): string[] {
  const ids: string[] = [];
  for (const action of actions) {
    if (action.type === "show_dialog") ids.push(action.dialogId);
    else if (action.type === "delay") ids.push(...dialogsShownBy(action.actions));
  }
  return ids;
}
