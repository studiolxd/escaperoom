import * as Y from "yjs";
import type { Rule, RuleTrigger } from "@escaperoom/shared/schemas";
import { ruleReferences, type RuleReferenceKind } from "@escaperoom/shared/validator";
import { getRulesMap, setRule } from "../rules-graph/yjs-rules";
import { RoomDocError, assertFreeId, slugifyId, usedIds, type RoomDocErrorCode } from "./commands";
import { collection, type RecordCollection } from "./doc-model";
import type { AddOptions } from "./content";

/**
 * Comandos de lógica de la sala (ticket 4.3): reglas SI/ENTONCES completas
 * sobre el MISMO mapa `rules` del grafo de 3.6 (`rules-graph/yjs-rules.ts`) y
 * consultas filtradas. Una regla solo entra en el doc si todo lo que referencia
 * (habitaciones, objetos, puzzles, items, diálogos) existe.
 */

const REFERENCE_TARGET: Record<
  RuleReferenceKind,
  { collection: RecordCollection; code: RoomDocErrorCode; label: string }
> = {
  room: { collection: "subrooms", code: "UNKNOWN_ROOM", label: "la habitación" },
  object: { collection: "objects", code: "UNKNOWN_OBJECT", label: "el objeto" },
  puzzle: { collection: "puzzles", code: "UNKNOWN_PUZZLE", label: "el puzzle" },
  item: { collection: "items", code: "UNKNOWN_ITEM", label: "el item" },
  dialog: { collection: "dialogs", code: "UNKNOWN_DIALOG", label: "el diálogo" },
};

/**
 * Comprueba que existen todas las entidades que referencia la regla; la
 * primera que falta lanza `RoomDocError` con su código (`UNKNOWN_OBJECT`…) y
 * la ruta dentro de la regla.
 */
export function assertRuleReferences(doc: Y.Doc, rule: Rule): void {
  for (const reference of ruleReferences(rule)) {
    const target = REFERENCE_TARGET[reference.kind];
    if (!collection(doc, target.collection).has(reference.id)) {
      throw new RoomDocError(
        target.code,
        `No existe ${target.label} "${reference.id}" (en ${reference.path})`,
      );
    }
  }
}

/** Parte legible del id de una regla según su disparador. */
function triggerStem(trigger: RuleTrigger): string {
  switch (trigger.type) {
    case "on_interact":
      return trigger.objectId;
    case "on_use_item":
      return `${trigger.itemId}-en-${trigger.objectId}`;
    case "on_enter_room":
      return `entrar-${trigger.roomId}`;
    case "on_puzzle_solved":
      return `${trigger.puzzleId.replace(/^p-/, "")}-resuelto`;
    case "on_item_collected":
      return `recoger-${trigger.itemId}`;
    case "on_timer":
      return trigger.timerId;
    case "on_timer_end":
      return `${trigger.timerId}-fin`;
    case "on_time_remaining_below":
      return `quedan-${trigger.seconds}s`;
    case "on_all_players_in_zone":
      return typeof trigger.zone === "string" ? `todos-en-${trigger.zone}` : "todos-en-zona";
    case "on_game_start":
      return "inicio";
  }
}

/**
 * Id legible propuesto para una regla nueva (`r-brasero`, `r-candado-arca-resuelto`),
 * libre en el espacio de ids compartido, con sufijo numérico si hace falta.
 */
export function proposeRuleId(doc: Y.Doc, trigger: RuleTrigger): string {
  const stem = `r-${slugifyId(triggerStem(trigger))}`;
  const used = usedIds(doc);
  if (!used.has(stem)) return stem;
  let n = 2;
  while (used.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/**
 * Alta de una regla completa (el `add_rule` del MCP). Valida las referencias y
 * el id (espacio compartido); con `replace`, sustituye la regla del mismo id
 * conservando su orden de creación (el desempate del motor).
 */
export function addRule(doc: Y.Doc, rule: Rule, opts: AddOptions = {}): { replaced: boolean } {
  let result = { replaced: false };
  doc.transact(() => {
    assertRuleReferences(doc, rule);
    const exists = getRulesMap(doc).has(rule.id);
    if (!(exists && opts.replace)) assertFreeId(doc, rule.id);
    result = setRule(doc, rule);
  });
  return result;
}
