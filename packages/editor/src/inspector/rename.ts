import * as Y from "yjs";
import { isValidObjectId, usedIds } from "../room-doc/commands";
import {
  ORDER_KEY,
  buildFlatRecord,
  collection,
  nextOrder,
  plain,
  readFlatRecord,
  readPlain,
  type RecordMap,
} from "../room-doc/doc-model";
import { getRulesMap, renameRule } from "../rules-graph/yjs-rules";
import {
  HINT_REFS,
  LIGHT_REFS,
  OBJECT_REFS,
  puzzleRefs,
  rewriteRefs,
  ruleNodeRefs,
  type RefKind,
  type RefSpec,
} from "./references";
import { InspectorError, type InspectorTarget } from "./target";

/**
 * Renombrado de ids con reescritura de referencias (specs/09 §3: «Renombrar
 * IDs»). Todo va en UNA transacción Yjs: los colaboradores (otra pestaña, el
 * MCP) ven el cambio de id y todas sus referencias a la vez, nunca una regla
 * apuntando a un id que ya no existe. Solo se reescriben los campos del mapa
 * semántico de `references.ts`.
 */

export type RenameResult = {
  id: string;
  /** Referencias reescritas, como `colección.id.campo` (para avisar en la UI). */
  rewritten: string[];
};

function assertNewId(doc: Y.Doc, newId: string): void {
  if (!isValidObjectId(newId)) {
    throw new InspectorError("INVALID_ID", `"${newId}" no es un id válido (a-z, 0-9 y guiones)`);
  }
  if (usedIds(doc).has(newId)) {
    throw new InspectorError("DUPLICATE_ID", `Ya existe el id "${newId}"`);
  }
}

/** Reescribe las propiedades planas de una entrada (objeto, puzzle, pista). */
function rewriteFlatRecord(
  record: RecordMap,
  specs: readonly RefSpec[],
  kind: RefKind,
  from: string,
  to: string,
  where: string,
  rewritten: string[],
): void {
  const heads = new Set(specs.filter((s) => s.kind === kind).map((s) => s.path[0] as string));
  for (const key of heads) {
    if (!record.has(key)) continue;
    const value = readPlain(record, key);
    const next = rewriteRefs({ [key]: value }, specs, kind, from, to)[key];
    if (next !== value) {
      record.set(key, plain(next));
      rewritten.push(`${where}.${key}`);
    }
  }
}

/** Reescribe un `Y.Array` de piezas de regla (condiciones, acciones, luces) elemento a elemento. */
function rewriteArray(
  array: Y.Array<unknown>,
  specsOf: (item: unknown) => readonly RefSpec[],
  kind: RefKind,
  from: string,
  to: string,
  where: string,
  rewritten: string[],
): void {
  const items = array.toJSON() as unknown[];
  items.forEach((item, index) => {
    const next = rewriteRefs(item, specsOf(item), kind, from, to);
    if (next === item) return;
    array.delete(index, 1);
    array.insert(index, [plain(next)]);
    rewritten.push(`${where}[${index}]`);
  });
}

/** Reescribe en toda la sala las referencias `kind: from → to` (dentro de la transacción). */
export function rewriteReferences(doc: Y.Doc, kind: RefKind, from: string, to: string): string[] {
  const rewritten: string[] = [];
  for (const [id, record] of collection(doc, "objects").entries()) {
    rewriteFlatRecord(record, OBJECT_REFS, kind, from, to, `objects.${id}`, rewritten);
  }
  for (const [id, record] of collection(doc, "puzzles").entries()) {
    const type = record.get("type");
    const specs = puzzleRefs(typeof type === "string" ? type : undefined);
    rewriteFlatRecord(record, specs, kind, from, to, `puzzles.${id}`, rewritten);
  }
  for (const [id, record] of collection(doc, "hints").entries()) {
    rewriteFlatRecord(record, HINT_REFS, kind, from, to, `hints.${id}`, rewritten);
  }
  for (const [id, record] of collection(doc, "dialogs").entries()) {
    const conditions = readPlain(record, "conditions");
    if (!Array.isArray(conditions)) continue;
    let changed = false;
    const next = conditions.map((condition: unknown) => {
      const out = rewriteRefs(condition, ruleNodeRefs(condition), kind, from, to);
      if (out !== condition) changed = true;
      return out;
    });
    if (changed) {
      record.set("conditions", plain(next));
      rewritten.push(`dialogs.${id}.conditions`);
    }
  }
  for (const [id, room] of collection(doc, "subrooms").entries()) {
    const lighting = room.get("lighting");
    if (lighting instanceof Y.Array) {
      rewriteArray(
        lighting,
        () => LIGHT_REFS,
        kind,
        from,
        to,
        `subrooms.${id}.lighting`,
        rewritten,
      );
    }
  }
  for (const [id, rule] of getRulesMap(doc).entries()) {
    const trigger = readPlain(rule, "trigger");
    const nextTrigger = rewriteRefs(trigger, ruleNodeRefs(trigger), kind, from, to);
    if (nextTrigger !== trigger) {
      rule.set("trigger", plain(nextTrigger));
      rewritten.push(`rules.${id}.trigger`);
    }
    for (const part of ["conditions", "actions"] as const) {
      const array = rule.get(part);
      if (array instanceof Y.Array) {
        rewriteArray(array, ruleNodeRefs, kind, from, to, `rules.${id}.${part}`, rewritten);
      }
    }
  }
  return rewritten;
}

function renameFlatEntry(doc: Y.Doc, name: "objects" | "puzzles", id: string, newId: string): void {
  const map = collection(doc, name);
  const record = map.get(id);
  if (!record) throw new InspectorError("UNKNOWN_TARGET", `No existe "${id}" en ${name}`);
  const value = readFlatRecord(record);
  const order = record.get(ORDER_KEY);
  map.delete(id);
  map.set(
    newId,
    buildFlatRecord({ ...value, id: newId }, typeof order === "number" ? order : nextOrder(map)),
  );
}

/**
 * Renombra un objeto, puzzle o regla y reescribe todas sus referencias en una
 * sola transacción. Lanza `InspectorError` (`INVALID_ID`, `DUPLICATE_ID`,
 * `UNKNOWN_TARGET`) sin tocar el doc.
 */
export function renameElement(doc: Y.Doc, target: InspectorTarget, newId: string): RenameResult {
  const { kind, id } = target;
  if (id === newId) return { id, rewritten: [] };
  const exists = kind === "rule" ? getRulesMap(doc).has(id) : collection(doc, `${kind}s`).has(id);
  if (!exists) throw new InspectorError("UNKNOWN_TARGET", `No existe ${kind} "${id}"`);
  assertNewId(doc, newId);

  let rewritten: string[] = [];
  doc.transact(() => {
    if (kind === "rule") {
      // Ninguna parte del RoomPackage referencia reglas por id.
      renameRule(doc, id, newId);
      return;
    }
    rewritten = rewriteReferences(doc, kind, id, newId);
    renameFlatEntry(doc, kind === "object" ? "objects" : "puzzles", id, newId);
  });
  return { id: newId, rewritten };
}
