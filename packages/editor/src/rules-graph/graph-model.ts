import type { Edge, Node } from "@xyflow/react";
import type { ActionPath } from "./yjs-rules";
import type { Rule, RuleAction, RuleCondition, RuleTrigger } from "./vocabulary";

/**
 * Mapeo puro reglas del RoomPackage ⇄ grafo de nodos/aristas (specs/09 §4.2).
 * Sin React ni Yjs: lo usan el componente, los tests y, en 3.7, el validador.
 *
 * Forma del grafo de una regla:
 *
 *   [trigger] → [cond 0] → [cond 1] → … ┬→ [acción 0]
 *                                       ├→ [acción 1: delay] → [acción 1.0]
 *                                       └→ [acción 2]
 *
 * Las condiciones van en cadena (se evalúan todas, en orden: AND) y la última
 * condición (o el trigger si no hay) abre en abanico hacia las acciones. Un
 * `delay` es a su vez origen de sus acciones anidadas.
 */

export type IssueSeverity = "error" | "warning" | "info";

/**
 * Problema señalado por el validador (3.7). `id` puede ser el id de un nodo o el
 * id de una regla (entonces se marca su nodo trigger, la cabeza de la regla).
 */
export type RuleGraphIssue = { id: string; severity: IssueSeverity; message?: string };

type NodeBase = {
  ruleId: string;
  severity?: IssueSeverity;
  messages?: string[];
};

export type TriggerNodeData = NodeBase & {
  kind: "trigger";
  priority: number;
  once: boolean;
  trigger: RuleTrigger;
};

export type ConditionNodeData = NodeBase & {
  kind: "condition";
  index: number;
  condition: RuleCondition;
};

/** En un `delay`, `action` no incluye `actions`: sus hijas son nodos propios. */
export type ActionNodeData = NodeBase & {
  kind: "action";
  path: number[];
  action: RuleAction;
};

export type RuleNodeData = TriggerNodeData | ConditionNodeData | ActionNodeData;

export const RULE_NODE_TYPES = {
  trigger: "ruleTrigger",
  condition: "ruleCondition",
  action: "ruleAction",
} as const;

export type TriggerNode = Node<TriggerNodeData, typeof RULE_NODE_TYPES.trigger>;
export type ConditionNode = Node<ConditionNodeData, typeof RULE_NODE_TYPES.condition>;
export type ActionNode = Node<ActionNodeData, typeof RULE_NODE_TYPES.action>;
export type RuleGraphNode = TriggerNode | ConditionNode | ActionNode;
export type RuleGraphEdge = Edge;

export type RuleGraph = { nodes: RuleGraphNode[]; edges: RuleGraphEdge[] };

export const triggerNodeId = (ruleId: string) => `${ruleId}/trigger`;
export const conditionNodeId = (ruleId: string, index: number) => `${ruleId}/c/${index}`;
export const actionNodeId = (ruleId: string, path: ActionPath) => `${ruleId}/a/${path.join(".")}`;
const edgeId = (source: string, target: string) => `${source}->${target}`;

/** Separación de la maquetación automática (px). */
export const LAYOUT = { columnWidth: 320, rowHeight: 170, ruleGap: 60 } as const;

function edge(source: string, target: string): RuleGraphEdge {
  return { id: edgeId(source, target), source, target };
}

/** Filas que ocupa una lista de acciones (un `delay` ocupa las de sus hijas). */
function actionRows(actions: readonly RuleAction[]): number {
  return actions.reduce(
    (sum, action) => sum + (action.type === "delay" ? Math.max(1, actionRows(action.actions)) : 1),
    0,
  );
}

function stripNested(action: RuleAction): RuleAction {
  if (action.type !== "delay") return action;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { actions, ...rest } = action;
  return rest as RuleAction;
}

/** Reglas → grafo con maquetación automática: una banda horizontal por regla. */
export function rulesToGraph(rules: readonly Rule[]): RuleGraph {
  const nodes: RuleGraphNode[] = [];
  const edges: RuleGraphEdge[] = [];
  const { columnWidth, rowHeight, ruleGap } = LAYOUT;
  let top = 0;

  for (const rule of rules) {
    const triggerId = triggerNodeId(rule.id);
    nodes.push({
      id: triggerId,
      type: RULE_NODE_TYPES.trigger,
      position: { x: 0, y: top },
      data: {
        kind: "trigger",
        ruleId: rule.id,
        priority: rule.priority,
        once: rule.once,
        trigger: rule.trigger,
      },
    });

    let tail = triggerId;
    rule.conditions.forEach((condition, index) => {
      const id = conditionNodeId(rule.id, index);
      nodes.push({
        id,
        type: RULE_NODE_TYPES.condition,
        position: { x: columnWidth * (index + 1), y: top },
        data: { kind: "condition", ruleId: rule.id, index, condition },
      });
      edges.push(edge(tail, id));
      tail = id;
    });

    const placeActions = (
      actions: readonly RuleAction[],
      parentPath: number[],
      source: string,
      column: number,
      startRow: number,
    ) => {
      let row = startRow;
      actions.forEach((action, index) => {
        const path = [...parentPath, index];
        const id = actionNodeId(rule.id, path);
        nodes.push({
          id,
          type: RULE_NODE_TYPES.action,
          position: { x: columnWidth * column, y: top + row * rowHeight },
          data: { kind: "action", ruleId: rule.id, path, action: stripNested(action) },
        });
        edges.push(edge(source, id));
        if (action.type === "delay") {
          placeActions(action.actions, path, id, column + 1, row);
          row += Math.max(1, actionRows(action.actions));
        } else {
          row += 1;
        }
      });
    };
    placeActions(rule.actions, [], tail, rule.conditions.length + 1, 0);

    top += Math.max(1, actionRows(rule.actions)) * rowHeight + ruleGap;
  }

  return { nodes, edges };
}

/**
 * Grafo → reglas. Inversa exacta de `rulesToGraph`: recorre las aristas desde
 * cada trigger (cadena de condiciones y abanico de acciones) y ordena hermanas
 * por su índice. Los nodos que no cuelgan de ningún trigger se ignoran.
 */
export function graphToRules(graph: RuleGraph): Rule[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const targets = new Map<string, RuleGraphNode[]>();
  for (const e of graph.edges) {
    const target = byId.get(e.target);
    if (!target) continue;
    const list = targets.get(e.source) ?? [];
    list.push(target);
    targets.set(e.source, list);
  }
  const lastIndex = (node: ActionNode) => node.data.path[node.data.path.length - 1] ?? 0;

  const collectActions = (source: string, visited: Set<string>): RuleAction[] =>
    (targets.get(source) ?? [])
      .filter((node): node is ActionNode => node.data.kind === "action" && !visited.has(node.id))
      .sort((a, b) => lastIndex(a) - lastIndex(b))
      .map((node) => {
        visited.add(node.id);
        const action = node.data.action;
        if (action.type !== "delay") return action;
        return { ...action, actions: collectActions(node.id, visited) };
      });

  const rules: Rule[] = [];
  for (const node of graph.nodes) {
    if (node.data.kind !== "trigger") continue;
    const visited = new Set<string>([node.id]);
    const conditions: RuleCondition[] = [];
    let tail: string = node.id;
    for (;;) {
      const next = (targets.get(tail) ?? []).find(
        (n): n is ConditionNode => n.data.kind === "condition" && !visited.has(n.id),
      );
      if (!next) break;
      visited.add(next.id);
      conditions.push(next.data.condition);
      tail = next.id;
    }
    rules.push({
      id: node.data.ruleId,
      priority: node.data.priority,
      once: node.data.once,
      trigger: node.data.trigger,
      conditions,
      actions: collectActions(tail, visited),
    });
  }
  return rules;
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { info: 0, warning: 1, error: 2 };

/**
 * Estilos por nodo dirigidos por datos (specs/09 §4.2): marca cada nodo con la
 * severidad más alta de sus problemas y añade la clase
 * `rules-graph-node--<severidad>`. Pensado para que el validador de 3.7 solo
 * tenga que producir `RuleGraphIssue[]`.
 */
export function applyIssues<N extends RuleGraphNode>(
  nodes: readonly N[],
  issues: readonly RuleGraphIssue[],
): N[] {
  if (issues.length === 0) return [...nodes];
  const byTarget = new Map<string, RuleGraphIssue[]>();
  for (const issue of issues) {
    const list = byTarget.get(issue.id) ?? [];
    list.push(issue);
    byTarget.set(issue.id, list);
  }
  return nodes.map((node) => {
    const matched = [
      ...(byTarget.get(node.id) ?? []),
      ...(node.data.kind === "trigger" ? (byTarget.get(node.data.ruleId) ?? []) : []),
    ];
    if (matched.length === 0) return node;
    const severity = matched.reduce<IssueSeverity>(
      (worst, issue) =>
        SEVERITY_RANK[issue.severity] > SEVERITY_RANK[worst] ? issue.severity : worst,
      "info",
    );
    const messages = matched.flatMap((issue) => (issue.message ? [issue.message] : []));
    return {
      ...node,
      className: [node.className, `rules-graph-node--${severity}`].filter(Boolean).join(" "),
      data: { ...node.data, severity, messages },
    };
  });
}
