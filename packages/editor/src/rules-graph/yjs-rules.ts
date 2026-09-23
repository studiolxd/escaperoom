import * as Y from "yjs";
import type { Rule, RuleAction, RuleCondition, RuleTrigger } from "./vocabulary";

/**
 * Porción `rules` del doc Yjs de la sala (specs/09 §2). Es la fuente de verdad
 * del grafo: el componente solo lee de aquí y escribe con las operaciones de
 * este módulo, de modo que cualquier otro colaborador (otra pestaña, el MCP)
 * que mute el mismo mapa se refleja sin lógica adicional.
 *
 * Estructura:
 *
 *   doc.getMap("rules"): Y.Map<ruleId, Y.Map>
 *     ├── id: string              (igual a la clave)
 *     ├── priority: number
 *     ├── once: boolean
 *     ├── order: number           (orden de creación; no se exporta al RoomPackage)
 *     ├── trigger: RuleTrigger    (JSON; se sustituye entero al editarlo)
 *     ├── conditions: Y.Array<RuleCondition>
 *     └── actions: Y.Array<RuleAction>   (un `delay` guarda su lista anidada en JSON)
 *
 * El mapa por id (y no un Y.Array) permite que dos colaboradores editen reglas
 * distintas sin conflicto de índices; `order` conserva el desempate por orden de
 * creación que usa el motor (specs/05 §2.1).
 */
export const RULES_MAP_KEY = "rules";

type RuleYMap = Y.Map<unknown>;

export class RulesDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesDocError";
  }
}

export function getRulesMap(doc: Y.Doc): Y.Map<RuleYMap> {
  return doc.getMap<RuleYMap>(RULES_MAP_KEY);
}

/** Copia JSON profunda: Yjs no admite `undefined` y no debe compartir referencias. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ruleMap(doc: Y.Doc, ruleId: string): RuleYMap {
  const rule = getRulesMap(doc).get(ruleId);
  if (!rule) throw new RulesDocError(`No existe la regla "${ruleId}"`);
  return rule;
}

function conditionsOf(rule: RuleYMap): Y.Array<RuleCondition> {
  return rule.get("conditions") as Y.Array<RuleCondition>;
}

function actionsOf(rule: RuleYMap): Y.Array<RuleAction> {
  return rule.get("actions") as Y.Array<RuleAction>;
}

function buildRuleMap(rule: Rule, order: number): RuleYMap {
  const map = new Y.Map<unknown>();
  map.set("id", rule.id);
  map.set("priority", rule.priority);
  map.set("once", rule.once);
  map.set("order", order);
  map.set("trigger", plain(rule.trigger));
  const conditions = new Y.Array<RuleCondition>();
  conditions.push(plain(rule.conditions));
  map.set("conditions", conditions);
  const actions = new Y.Array<RuleAction>();
  actions.push(plain(rule.actions));
  map.set("actions", actions);
  return map;
}

function nextOrder(rules: Y.Map<RuleYMap>): number {
  let max = -1;
  for (const rule of rules.values()) max = Math.max(max, Number(rule.get("order") ?? 0));
  return max + 1;
}

/** Lee las reglas del doc en orden de creación (desempate por id). */
export function readRules(doc: Y.Doc): Rule[] {
  const entries = [...getRulesMap(doc).entries()];
  entries.sort(([idA, a], [idB, b]) => {
    const diff = Number(a.get("order") ?? 0) - Number(b.get("order") ?? 0);
    return diff !== 0 ? diff : idA < idB ? -1 : idA > idB ? 1 : 0;
  });
  return entries.map(([id, rule]) => ({
    id,
    priority: rule.get("priority") as number,
    once: rule.get("once") as boolean,
    trigger: plain(rule.get("trigger") as RuleTrigger),
    conditions: conditionsOf(rule).toJSON() as RuleCondition[],
    actions: actionsOf(rule).toJSON() as RuleAction[],
  }));
}

/** Sustituye todas las reglas del doc (importar un RoomPackage) en una transacción. */
export function writeRules(doc: Y.Doc, rules: readonly Rule[]): void {
  doc.transact(() => {
    const map = getRulesMap(doc);
    map.clear();
    rules.forEach((rule, index) => map.set(rule.id, buildRuleMap(rule, index)));
  });
}

/** Suscripción a cualquier cambio (propio o remoto) de la porción `rules`. */
export function observeRules(doc: Y.Doc, listener: () => void): () => void {
  const map = getRulesMap(doc);
  const handler = () => listener();
  map.observeDeep(handler);
  return () => map.unobserveDeep(handler);
}

/** Id libre del estilo `r-nueva-3` (los ids de regla son legibles, specs/09 §3). */
export function nextRuleId(doc: Y.Doc, base = "r-nueva"): string {
  const map = getRulesMap(doc);
  if (!map.has(base)) return base;
  let n = 2;
  while (map.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export type CreateRuleInput = {
  trigger: RuleTrigger;
  id?: string;
  priority?: number;
  once?: boolean;
};

/** Crea una regla vacía (sin condiciones ni acciones) y devuelve su id. */
export function createRule(doc: Y.Doc, input: CreateRuleInput): string {
  const id = input.id ?? nextRuleId(doc);
  doc.transact(() => {
    const map = getRulesMap(doc);
    if (map.has(id)) throw new RulesDocError(`Ya existe la regla "${id}"`);
    const rule: Rule = {
      id,
      priority: input.priority ?? 0,
      once: input.once ?? true,
      trigger: input.trigger,
      conditions: [],
      actions: [],
    };
    map.set(id, buildRuleMap(rule, nextOrder(map)));
  });
  return id;
}

/**
 * Escribe una regla completa (trigger, condiciones y acciones de una vez, como
 * la manda el MCP): sustituye la del mismo id conservando su `order`, o la
 * añade al final. Quien llama decide si sustituir está permitido.
 */
export function setRule(doc: Y.Doc, rule: Rule): { replaced: boolean } {
  let replaced = false;
  doc.transact(() => {
    const map = getRulesMap(doc);
    const existing = map.get(rule.id);
    replaced = existing !== undefined;
    const order = existing ? Number(existing.get("order") ?? 0) : nextOrder(map);
    map.set(rule.id, buildRuleMap(rule, order));
  });
  return { replaced };
}

export function deleteRule(doc: Y.Doc, ruleId: string): void {
  doc.transact(() => {
    ruleMap(doc, ruleId);
    getRulesMap(doc).delete(ruleId);
  });
}

export type RulePatch = { priority?: number; once?: boolean; trigger?: RuleTrigger };

export function updateRule(doc: Y.Doc, ruleId: string, patch: RulePatch): void {
  doc.transact(() => {
    const rule = ruleMap(doc, ruleId);
    if (patch.priority !== undefined) rule.set("priority", patch.priority);
    if (patch.once !== undefined) rule.set("once", patch.once);
    if (patch.trigger !== undefined) rule.set("trigger", plain(patch.trigger));
  });
}

/** Renombra una regla conservando su contenido y su posición en el orden. */
export function renameRule(doc: Y.Doc, ruleId: string, newId: string): void {
  if (ruleId === newId) return;
  doc.transact(() => {
    const map = getRulesMap(doc);
    if (map.has(newId)) throw new RulesDocError(`Ya existe la regla "${newId}"`);
    const rule = ruleMap(doc, ruleId);
    const current = readRules(doc).find((r) => r.id === ruleId);
    if (!current) throw new RulesDocError(`No existe la regla "${ruleId}"`);
    const order = Number(rule.get("order") ?? 0);
    map.delete(ruleId);
    map.set(newId, buildRuleMap({ ...current, id: newId }, order));
  });
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

export function insertCondition(
  doc: Y.Doc,
  ruleId: string,
  condition: RuleCondition,
  index?: number,
): void {
  doc.transact(() => {
    const list = conditionsOf(ruleMap(doc, ruleId));
    list.insert(clampIndex(index, list.length), [plain(condition)]);
  });
}

export function updateCondition(
  doc: Y.Doc,
  ruleId: string,
  index: number,
  condition: RuleCondition,
): void {
  doc.transact(() => {
    const list = conditionsOf(ruleMap(doc, ruleId));
    if (index < 0 || index >= list.length) {
      throw new RulesDocError(`La regla "${ruleId}" no tiene condición ${index}`);
    }
    list.delete(index, 1);
    list.insert(index, [plain(condition)]);
  });
}

export function removeCondition(doc: Y.Doc, ruleId: string, index: number): RuleCondition {
  let removed: RuleCondition | undefined;
  doc.transact(() => {
    const list = conditionsOf(ruleMap(doc, ruleId));
    removed = list.get(index);
    if (removed === undefined) {
      throw new RulesDocError(`La regla "${ruleId}" no tiene condición ${index}`);
    }
    list.delete(index, 1);
  });
  return removed as RuleCondition;
}

/**
 * Ruta de una acción dentro de la regla: `[i]` es la acción de nivel superior
 * `i`; `[i, j]` es la acción `j` anidada en el `delay` `i`, y así sucesivamente.
 */
export type ActionPath = readonly number[];

function resolveList(actions: RuleAction[], parent: ActionPath, ruleId: string): RuleAction[] {
  let list = actions;
  for (const index of parent) {
    const action = list[index];
    if (!action || action.type !== "delay") {
      throw new RulesDocError(`La ruta [${parent.join(", ")}] de "${ruleId}" no es un delay`);
    }
    list = action.actions;
  }
  return list;
}

/**
 * Aplica `mutate` sobre la lista de acciones anidadas en `parent` (no vacío):
 * sustituye el `delay` de primer nivel que las contiene, que se guarda como JSON.
 */
function mutateNestedActions(
  doc: Y.Doc,
  ruleId: string,
  parent: ActionPath,
  mutate: (list: RuleAction[]) => void,
): void {
  doc.transact(() => {
    const yActions = actionsOf(ruleMap(doc, ruleId));
    const [top, ...rest] = parent as [number, ...number[]];
    const root = yActions.get(top);
    if (!root || root.type !== "delay") {
      throw new RulesDocError(`La acción ${top} de "${ruleId}" no es un delay`);
    }
    const copy = plain(root) as Extract<RuleAction, { type: "delay" }>;
    mutate(resolveList(copy.actions, rest, ruleId));
    yActions.delete(top, 1);
    yActions.insert(top, [copy]);
  });
}

/** Inserta una acción de nivel superior sin reescribir el resto (edición concurrente). */
export function insertAction(
  doc: Y.Doc,
  ruleId: string,
  action: RuleAction,
  opts: { parent?: ActionPath; index?: number } = {},
): void {
  const parent = opts.parent ?? [];
  if (parent.length === 0) {
    doc.transact(() => {
      const list = actionsOf(ruleMap(doc, ruleId));
      list.insert(clampIndex(opts.index, list.length), [plain(action)]);
    });
    return;
  }
  mutateNestedActions(doc, ruleId, parent, (list) => {
    list.splice(clampIndex(opts.index, list.length), 0, plain(action));
  });
}

function splitPath(path: ActionPath): { parent: number[]; index: number } {
  if (path.length === 0) throw new RulesDocError("Ruta de acción vacía");
  return { parent: path.slice(0, -1), index: path[path.length - 1] as number };
}

/**
 * Sustituye una acción. Si `action` es un `delay` sin `actions` (así lo edita el
 * nodo del grafo, cuyas hijas son nodos aparte) conserva las acciones anidadas
 * que ya tuviera.
 */
export function updateAction(
  doc: Y.Doc,
  ruleId: string,
  path: ActionPath,
  action: RuleAction | Omit<Extract<RuleAction, { type: "delay" }>, "actions">,
): void {
  const { parent, index } = splitPath(path);
  const merge = (previous: RuleAction | undefined): RuleAction => {
    if (previous === undefined) {
      throw new RulesDocError(`La regla "${ruleId}" no tiene acción [${path.join(", ")}]`);
    }
    if (action.type === "delay" && !("actions" in action)) {
      return plain({ ...action, actions: previous.type === "delay" ? previous.actions : [] });
    }
    return plain(action as RuleAction);
  };
  if (parent.length === 0) {
    doc.transact(() => {
      const list = actionsOf(ruleMap(doc, ruleId));
      const next = merge(index >= 0 && index < list.length ? list.get(index) : undefined);
      list.delete(index, 1);
      list.insert(index, [next]);
    });
    return;
  }
  mutateNestedActions(doc, ruleId, parent, (list) => {
    list[index] = merge(index >= 0 && index < list.length ? list[index] : undefined);
  });
}

export function removeAction(doc: Y.Doc, ruleId: string, path: ActionPath): RuleAction {
  const { parent, index } = splitPath(path);
  let removed: RuleAction | undefined;
  if (parent.length === 0) {
    doc.transact(() => {
      const list = actionsOf(ruleMap(doc, ruleId));
      removed = list.get(index);
      if (removed === undefined) {
        throw new RulesDocError(`La regla "${ruleId}" no tiene acción ${index}`);
      }
      list.delete(index, 1);
    });
  } else {
    mutateNestedActions(doc, ruleId, parent, (list) => {
      removed = list[index];
      if (removed === undefined) {
        throw new RulesDocError(`La regla "${ruleId}" no tiene acción [${path.join(", ")}]`);
      }
      list.splice(index, 1);
    });
  }
  return removed as RuleAction;
}
