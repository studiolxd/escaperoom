import type {
  PuzzleDefinition,
  RoomPackage,
  Rule,
  RuleAction,
  RuleCondition,
  RuleTrigger,
} from "@escaperoom/shared/schemas";
import { puzzleGrants, recipeLabel, ruleReferences } from "@escaperoom/shared/validator";

/**
 * Grafo de la sala para que el agente razone (specs/10 §2, fase C): puzzles,
 * objetos y reglas con sus dependencias en un formato compacto. Deja fuera
 * todo lo que no es lógica (tiles, sprites, textos, posiciones), así que cabe
 * en muchos menos tokens que `get_room`.
 */
export type RoomGraph = {
  rooms: string[];
  items: string[];
  objects: GraphObject[];
  puzzles: GraphPuzzle[];
  rules: GraphRule[];
  /** Dependencias `[origen, relación, destino]` (ver `GraphRelation`). */
  edges: GraphEdge[];
};

export type GraphObject = {
  id: string;
  room: string;
  type: string;
  states?: string[];
  initial?: string;
  lockedBy?: string;
  leadsTo?: string;
};

export type GraphPuzzle = {
  id: string;
  type: PuzzleDefinition["type"];
  room: string;
  requires?: string[];
  unlocks?: string[];
  grants?: string[];
  recipes?: string[];
};

/**
 * Regla en una línea por parte: `when` es el trigger, `if` las condiciones y
 * `then` las acciones, cada una como `tipo(campo=valor, …)`.
 */
export type GraphRule = {
  id: string;
  when: string;
  if?: string[];
  then: string[];
  /** Solo si difiere del valor por defecto (0 / `true`). */
  priority?: number;
  once?: false;
};

/**
 * - `requiere`: el puzzle necesita otro resuelto.
 * - `desbloquea`: el puzzle abre un objeto (`unlocks` o `lockedBy`).
 * - `otorga`: el puzzle o el objeto da un item.
 * - `lleva_a`: la puerta conduce a una habitación.
 * - `dispara`: la entidad del trigger dispara la regla.
 * - `condiciona`: la entidad aparece en una condición de la regla.
 * - `afecta`: una acción de la regla actúa sobre la entidad.
 */
export type GraphRelation =
  "requiere" | "desbloquea" | "otorga" | "lleva_a" | "dispara" | "condiciona" | "afecta";

export type GraphEdge = [from: string, relation: GraphRelation, to: string];

function describe(entry: RuleTrigger | RuleCondition | RuleAction): string {
  if (entry.type === "delay") {
    return `delay(seconds=${entry.seconds})[${entry.actions.map(describe).join("; ")}]`;
  }
  const fields = Object.entries(entry)
    .filter(([key]) => key !== "type")
    .map(
      ([key, value]) =>
        `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    );
  return `${entry.type}(${fields.join(", ")})`;
}

function nonEmpty<T>(list: readonly T[]): T[] | undefined {
  return list.length > 0 ? [...list] : undefined;
}

/** Vista compacta de una regla (la misma que usa `get_room_graph`). */
export function compactRule(rule: Rule): GraphRule {
  return {
    id: rule.id,
    when: describe(rule.trigger),
    ...(rule.conditions.length > 0 ? { if: rule.conditions.map(describe) } : {}),
    then: rule.actions.map(describe),
    ...(rule.priority !== 0 ? { priority: rule.priority } : {}),
    ...(rule.once ? {} : { once: false as const }),
  };
}

export function buildRoomGraph(pkg: RoomPackage): RoomGraph {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const edge = (from: string, relation: GraphRelation, to: string): void => {
    const key = `${from}\u0000${relation}\u0000${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([from, relation, to]);
  };

  const objects = pkg.objects.map((object): GraphObject => {
    const states = Object.keys(object.states);
    if (object.lockedBy) edge(object.lockedBy, "desbloquea", object.id);
    if (object.leadsTo) edge(object.id, "lleva_a", object.leadsTo);
    if (object.hidingSpot) edge(object.id, "otorga", object.hidingSpot.contains);
    for (const item of object.inventory ?? []) edge(object.id, "otorga", item);
    return {
      id: object.id,
      room: object.roomId,
      type: object.type,
      ...(states.length > 0 ? { states } : {}),
      ...(object.initialState ? { initial: object.initialState } : {}),
      ...(object.lockedBy ? { lockedBy: object.lockedBy } : {}),
      ...(object.leadsTo ? { leadsTo: object.leadsTo } : {}),
    };
  });

  const puzzles = pkg.puzzles.map((puzzle): GraphPuzzle => {
    const grants = puzzleGrants(puzzle);
    for (const required of puzzle.requiresSolved) edge(puzzle.id, "requiere", required);
    for (const target of puzzle.unlocks) edge(puzzle.id, "desbloquea", target);
    for (const item of grants) edge(puzzle.id, "otorga", item);
    const requires = nonEmpty(puzzle.requiresSolved);
    const unlocks = nonEmpty(puzzle.unlocks);
    const granted = nonEmpty(grants);
    const recipes =
      puzzle.type === "combine_items" ? nonEmpty(puzzle.recipes.map(recipeLabel)) : undefined;
    return {
      id: puzzle.id,
      type: puzzle.type,
      room: puzzle.roomId,
      ...(requires ? { requires } : {}),
      ...(unlocks ? { unlocks } : {}),
      ...(granted ? { grants: granted } : {}),
      ...(recipes ? { recipes } : {}),
    };
  });

  const rules = pkg.rules.map((rule) => {
    for (const reference of ruleReferences(rule)) {
      if (reference.field === "trigger") edge(reference.id, "dispara", rule.id);
      else if (reference.field === "conditions") edge(reference.id, "condiciona", rule.id);
      else edge(rule.id, "afecta", reference.id);
    }
    return compactRule(rule);
  });

  return {
    rooms: pkg.map.rooms.map((room) => room.id),
    items: pkg.items.map((item) => item.id),
    objects,
    puzzles,
    rules,
    edges,
  };
}
