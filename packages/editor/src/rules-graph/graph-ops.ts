import type { Node } from "@xyflow/react";
import type * as Y from "yjs";
import type { RuleGraphEdge, RuleGraphNode } from "./graph-model";
import {
  deleteRule,
  insertAction,
  insertCondition,
  removeAction,
  removeCondition,
  type ActionPath,
} from "./yjs-rules";
import type { RuleAction, RuleCondition } from "./vocabulary";

/**
 * Operaciones del grafo (conectar, desconectar, borrar) traducidas a
 * mutaciones del doc Yjs. El RoomPackage no puede representar una condición o
 * acción suelta, así que las piezas sin regla viven como **borradores** en el
 * estado local del componente hasta que se conectan a una regla.
 */

export type DraftPayload =
  { kind: "condition"; condition: RuleCondition } | { kind: "action"; action: RuleAction };

export const RULE_DRAFT_NODE_TYPE = "ruleDraft" as const;

export type DraftNodeData = { kind: "draft"; payload: DraftPayload };
export type DraftNode = Node<DraftNodeData, typeof RULE_DRAFT_NODE_TYPE>;

/** ¿Se puede conectar un borrador de este tipo saliendo de `source`? */
export function canConnectDraft(source: RuleGraphNode, kind: DraftPayload["kind"]): boolean {
  const data = source.data;
  if (kind === "condition") return data.kind === "trigger" || data.kind === "condition";
  return data.kind !== "action" || data.action.type === "delay";
}

/**
 * Conecta un borrador a una regla existente:
 * - condición desde el trigger → primera condición; desde una condición → justo
 *   después de ella en la cadena;
 * - acción desde el trigger o una condición → al final de las acciones de la
 *   regla; desde un `delay` → al final de sus acciones anidadas.
 * Devuelve `false` (sin tocar el doc) si la conexión no es válida.
 */
export function connectDraft(doc: Y.Doc, source: RuleGraphNode, payload: DraftPayload): boolean {
  if (!canConnectDraft(source, payload.kind)) return false;
  const data = source.data;
  if (payload.kind === "condition") {
    const index = data.kind === "condition" ? data.index + 1 : 0;
    insertCondition(doc, data.ruleId, payload.condition, index);
    return true;
  }
  const parent: ActionPath = data.kind === "action" ? data.path : [];
  insertAction(doc, data.ruleId, payload.action, { parent });
  return true;
}

type Removal =
  | { kind: "rule"; ruleId: string }
  | { kind: "condition"; ruleId: string; index: number }
  | { kind: "action"; ruleId: string; path: number[] };

function removalOf(node: RuleGraphNode): Removal {
  const data = node.data;
  if (data.kind === "trigger") return { kind: "rule", ruleId: data.ruleId };
  if (data.kind === "condition")
    return { kind: "condition", ruleId: data.ruleId, index: data.index };
  return { kind: "action", ruleId: data.ruleId, path: data.path };
}

function comparePathsDesc(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = (b[i] as number) - (a[i] as number);
    if (diff !== 0) return diff;
  }
  return b.length - a.length;
}

const isPrefix = (prefix: readonly number[], path: readonly number[]) =>
  prefix.length < path.length && prefix.every((value, i) => path[i] === value);

/**
 * Aplica un borrado del grafo (teclas Supr/Retroceso o botón) al doc:
 * - nodo trigger → borra la regla entera;
 * - nodo condición/acción → la quita de su regla;
 * - arista cuyo destino sobrevive → **desconecta**: quita la pieza de la regla y
 *   la devuelve como borrador para que pueda reconectarse a otra.
 * Todo en una transacción, borrando de mayor a menor índice para que los
 * índices del grafo sigan siendo válidos durante la operación.
 */
export function applyGraphDeletion(
  doc: Y.Doc,
  graphNodes: readonly RuleGraphNode[],
  deleted: { nodes?: readonly { id: string }[]; edges?: readonly RuleGraphEdge[] },
): DraftPayload[] {
  const byId = new Map(graphNodes.map((node) => [node.id, node]));
  const deletedNodeIds = new Set((deleted.nodes ?? []).map((node) => node.id));

  const removals: { removal: Removal; keep: boolean }[] = [];
  for (const id of deletedNodeIds) {
    const node = byId.get(id);
    if (node) removals.push({ removal: removalOf(node), keep: false });
  }
  for (const e of deleted.edges ?? []) {
    if (deletedNodeIds.has(e.target) || deletedNodeIds.has(e.source)) continue;
    const target = byId.get(e.target);
    if (target && target.data.kind !== "trigger") {
      removals.push({ removal: removalOf(target), keep: true });
    }
  }

  const deletedRules = new Set(
    removals.flatMap(({ removal }) => (removal.kind === "rule" ? [removal.ruleId] : [])),
  );
  const deletedActionPaths = removals.flatMap(({ removal }) =>
    removal.kind === "action" ? [removal] : [],
  );

  const pending = removals.filter(({ removal }) => {
    if (removal.kind === "rule") return true;
    if (deletedRules.has(removal.ruleId)) return false;
    if (removal.kind === "action") {
      // Si se borra un delay, sus hijas se van con él.
      return !deletedActionPaths.some(
        (other) => other.ruleId === removal.ruleId && isPrefix(other.path, removal.path),
      );
    }
    return true;
  });

  // Orden total: por tipo y regla y, dentro de cada lista, mayor índice primero.
  const KIND_RANK = { rule: 0, condition: 1, action: 2 } as const;
  pending.sort(({ removal: ra }, { removal: rb }) => {
    if (ra.kind !== rb.kind) return KIND_RANK[ra.kind] - KIND_RANK[rb.kind];
    if (ra.ruleId !== rb.ruleId) return ra.ruleId < rb.ruleId ? -1 : 1;
    if (ra.kind === "condition" && rb.kind === "condition") return rb.index - ra.index;
    if (ra.kind === "action" && rb.kind === "action") return comparePathsDesc(ra.path, rb.path);
    return 0;
  });

  const seen = new Set<string>();
  const drafts: DraftPayload[] = [];
  doc.transact(() => {
    for (const { removal, keep } of pending) {
      const key = JSON.stringify(removal);
      if (seen.has(key)) continue;
      seen.add(key);
      if (removal.kind === "rule") {
        deleteRule(doc, removal.ruleId);
      } else if (removal.kind === "condition") {
        const condition = removeCondition(doc, removal.ruleId, removal.index);
        if (keep) drafts.push({ kind: "condition", condition });
      } else {
        const action = removeAction(doc, removal.ruleId, removal.path);
        if (keep) drafts.push({ kind: "action", action });
      }
    }
  });
  return drafts;
}
