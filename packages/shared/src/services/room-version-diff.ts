import type { PuzzleDefinition, Rule, RuleAction, RoomPackage } from "../schemas";

/**
 * Clasificación del cambio de contenido de un `RoomPackage` frente a la
 * última versión publicada (docs/DEUDA.md "Versión (semver) automática al
 * publicar…", ADR-035). `"none"` es un caso propio (nada cambió) que
 * `nextSemver` trata como error, no como PATCH.
 */
export type RoomPackageChange = "major" | "minor" | "patch" | "none";

/** JSON con las claves de los objetos ordenadas, para comparar por valor. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const deepEqual = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** `puzzleId`s que una regla referencia en su `trigger`/`conditions`/`actions` (recursa en `delay`). */
function collectRulePuzzleIds(rule: Rule): Set<string> {
  const ids = new Set<string>();
  if (rule.trigger.type === "on_puzzle_solved") ids.add(rule.trigger.puzzleId);
  for (const condition of rule.conditions) {
    if (condition.type === "puzzle_state_is") ids.add(condition.puzzleId);
  }
  const walkActions = (actions: readonly RuleAction[]): void => {
    for (const action of actions) {
      if (action.type === "open_panel_puzzle") ids.add(action.puzzleId);
      else if (action.type === "delay") walkActions(action.actions);
    }
  };
  walkActions(rule.actions);
  return ids;
}

/** Diff de un array por `id`: qué ids se añadieron, se eliminaron o cambiaron de contenido. */
function diffById<T extends { id: string }>(
  previous: readonly T[],
  candidate: readonly T[],
): { added: string[]; removed: string[]; changed: string[] } {
  const prevById = new Map(previous.map((item) => [item.id, item]));
  const candById = new Map(candidate.map((item) => [item.id, item]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const id of candById.keys()) if (!prevById.has(id)) added.push(id);
  for (const id of prevById.keys()) if (!candById.has(id)) removed.push(id);
  for (const [id, prevItem] of prevById) {
    const candItem = candById.get(id);
    if (candItem && !deepEqual(prevItem, candItem)) changed.push(id);
  }
  return { added, removed, changed };
}

/**
 * Clasifica el cambio de contenido entre la última `RoomPackage` publicada y
 * la candidata a publicar (docs/DEUDA.md, ADR-035):
 *
 * - `null` (primera publicación) → no se clasifica aquí: `nextSemver` fija
 *   siempre `1.0.0` sin llamar a esta función.
 * - **MAJOR**: se añade o elimina algún `puzzles[]` (por `id`).
 * - **MINOR**: mismo conjunto de ids de `puzzles[]`, pero algún puzzle
 *   existente cambió de contenido, o una regla añadida/eliminada/modificada
 *   referencia un `puzzleId` presente en ambas versiones.
 * - **PATCH**: hay alguna diferencia (`objects`, `map`, `items`, `dialogs`,
 *   `hints`, `meta.assetsManifest`, una regla que no referencia ningún
 *   puzzle…) pero nada de lo anterior.
 * - **`none`**: los dos paquetes son idénticos (ignorando `meta.id`,
 *   `meta.authorId` y `meta.version`, que el servidor siempre sobrescribe al
 *   congelar la versión).
 */
export function classifyRoomPackageChange(
  previous: RoomPackage | null,
  candidate: RoomPackage,
): RoomPackageChange {
  if (!previous) return "major";

  const puzzleDiff = diffById<PuzzleDefinition>(previous.puzzles, candidate.puzzles);
  if (puzzleDiff.added.length > 0 || puzzleDiff.removed.length > 0) return "major";
  if (puzzleDiff.changed.length > 0) return "minor";

  const puzzleIdsInBoth = new Set(candidate.puzzles.map((p) => p.id));
  const ruleDiff = diffById<Rule>(previous.rules, candidate.rules);
  const changedRuleIds = [...ruleDiff.added, ...ruleDiff.removed, ...ruleDiff.changed];
  const rulesById = new Map([...previous.rules, ...candidate.rules].map((r) => [r.id, r]));
  for (const ruleId of changedRuleIds) {
    const rule = rulesById.get(ruleId);
    if (!rule) continue;
    const referencedPuzzleIds = collectRulePuzzleIds(rule);
    for (const puzzleId of referencedPuzzleIds) {
      if (puzzleIdsInBoth.has(puzzleId)) return "minor";
    }
  }

  // Ya se comprobó que `puzzles`/`rules` no tienen ids añadidos, eliminados ni
  // con contenido distinto: se excluyen aquí (junto con `meta.id`/`authorId`/
  // `version`, que fija el servidor al congelar) para que ni un simple
  // reordenamiento (mismos ids, mismo contenido, otra posición) ni la
  // identidad de la versión cuenten como cambio.
  const comparableContent = ({ meta, map, objects, items, dialogs, hints }: RoomPackage) => ({
    meta: { ...meta, id: undefined, authorId: undefined, version: undefined },
    map,
    objects,
    items,
    dialogs,
    hints,
  });
  if (
    changedRuleIds.length === 0 &&
    deepEqual(comparableContent(previous), comparableContent(candidate))
  ) {
    return "none";
  }

  return "patch";
}
