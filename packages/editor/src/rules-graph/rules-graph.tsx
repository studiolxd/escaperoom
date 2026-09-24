"use client";

import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type XYPosition,
} from "@xyflow/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import {
  applyIssues,
  LAYOUT,
  rulesToGraph,
  RULE_NODE_TYPES,
  type ActionNode,
  type ConditionNode,
  type IssueSeverity,
  type RuleGraphIssue,
  type RuleGraphNode,
  type TriggerNode,
} from "./graph-model";
import {
  applyGraphDeletion,
  canConnectDraft,
  connectDraft,
  RULE_DRAFT_NODE_TYPE,
  type DraftNode,
  type DraftPayload,
} from "./graph-ops";
import { createLabeler, type Labeler, type RulesGraphLabelsInput } from "./labels";
import { useYjsRules } from "./use-yjs-rules";
import {
  ACTION_FIELDS,
  ACTION_TYPES,
  CONDITION_FIELDS,
  CONDITION_TYPES,
  defaultAction,
  defaultCondition,
  defaultTrigger,
  isActionType,
  isConditionType,
  isTriggerType,
  TRIGGER_FIELDS,
  TRIGGER_TYPES,
  type FieldSpec,
  type RuleAction,
  type RuleCondition,
} from "./vocabulary";
import {
  createRule,
  nextRuleId,
  renameRule,
  updateAction,
  updateCondition,
  updateRule,
} from "./yjs-rules";

export type RulesGraphProps = {
  /** Doc Yjs de la sala: el grafo lee y escribe su mapa `rules`. */
  doc: Y.Doc;
  /** Textos de la UI (ver `labels.ts`); lo ausente cae al identificador técnico. */
  labels?: RulesGraphLabelsInput;
  /** Problemas del validador (3.7) a resaltar por nodo o por regla. */
  issues?: readonly RuleGraphIssue[];
  readOnly?: boolean;
  /** Alto del lienzo (React Flow necesita un contenedor con tamaño). */
  height?: number | string;
  className?: string;
  /** Errores de edición (id duplicado, índice fuera de rango tras un cambio remoto…). */
  onError?: (error: unknown) => void;
  /**
   * Regla a enseñar (desde el inspector, 3.4): sus nodos salen seleccionados y
   * la vista se centra en ellos cada vez que cambia.
   */
  focusRuleId?: string;
  /** Clic en un nodo de una regla (el inspector la muestra). */
  onSelectRule?: (ruleId: string) => void;
};

type AnyNode = RuleGraphNode | DraftNode;

type GraphContextValue = {
  doc: Y.Doc;
  t: Labeler;
  readOnly: boolean;
  run: (fn: () => void) => void;
  updateDraft: (id: string, payload: DraftPayload) => void;
  deleteDraft: (id: string) => void;
};

const GraphContext = createContext<GraphContextValue | null>(null);

function useGraph(): GraphContextValue {
  const value = useContext(GraphContext);
  if (!value) throw new Error("Los nodos del grafo de reglas necesitan <RulesGraph>");
  return value;
}

const NODE_WIDTH = 260;

// ── Estilos (inline, dirigidos por datos: tipo de nodo y severidad) ─────────

const KIND_COLOR = {
  trigger: "#b45309",
  condition: "#1d4ed8",
  action: "#047857",
  draft: "#6b7280",
} as const;

const SEVERITY_COLOR: Record<IssueSeverity, string> = {
  error: "#dc2626",
  warning: "#d97706",
  info: "#0284c7",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontSize: 12,
  padding: "2px 4px",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  background: "#fff",
  color: "#111827",
};

// ── Campos ──────────────────────────────────────────────────────────────────

function displayValue(field: FieldSpec, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (field.kind === "json" && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Texto del input → valor del payload; `null` = entrada inválida (se revierte). */
function parseValue(field: FieldSpec, text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "" && field.optional) return undefined;
  switch (field.kind) {
    case "number": {
      const n = Number(trimmed);
      return trimmed === "" || Number.isNaN(n) ? null : n;
    }
    case "int": {
      const n = Number(trimmed);
      return trimmed === "" || !Number.isInteger(n) ? null : n;
    }
    case "flagValue":
      if (trimmed === "true") return true;
      if (trimmed === "false") return false;
      if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
      return text;
    case "json":
      if (!trimmed.startsWith("{")) return text;
      try {
        return JSON.parse(trimmed) as unknown;
      } catch {
        return null;
      }
    default:
      return text;
  }
}

function FieldInput(props: {
  field: FieldSpec;
  value: unknown;
  onCommit: (value: unknown) => void;
}) {
  const { field, value, onCommit } = props;
  const { t, readOnly } = useGraph();
  const shown = displayValue(field, value);
  const [text, setText] = useState(shown);
  // Un cambio externo (otro colaborador, el MCP) actualiza el input.
  useEffect(() => setText(shown), [shown]);

  const label = t.field(field.key);
  const common = {
    "aria-label": label,
    disabled: readOnly,
    className: "nodrag",
    style: inputStyle,
  };

  if (field.kind === "boolean" || field.kind === "enum") {
    const options =
      field.kind === "boolean"
        ? [
            { value: "true", label: t.ui("yes") },
            { value: "false", label: t.ui("no") },
          ]
        : (field.options ?? []).map((option) => ({ value: option, label: option }));
    return (
      <select
        {...common}
        value={shown}
        onChange={(event) => {
          const raw = event.target.value;
          onCommit(field.kind === "boolean" ? (raw === "" ? undefined : raw === "true") : raw);
        }}
      >
        {field.optional ? <option value="">{t.ui("unset")}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const commit = () => {
    if (text === shown) return;
    const parsed = parseValue(field, text);
    if (parsed === null) setText(shown);
    else onCommit(parsed);
  };
  return (
    <input
      {...common}
      type="text"
      inputMode={field.kind === "number" || field.kind === "int" ? "decimal" : undefined}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

function withField<T extends { type: string }>(payload: T, key: string, value: unknown): T {
  const next: Record<string, unknown> = { ...payload };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next as T;
}

function Fields<T extends { type: string }>(props: {
  fields: readonly FieldSpec[];
  payload: T;
  onChange: (next: T) => void;
}) {
  const { t } = useGraph();
  const { fields, payload, onChange } = props;
  if (fields.length === 0) return null;
  const values = payload as unknown as Record<string, unknown>;
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
      {fields.map((field) => (
        <label key={field.key} style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "#4b5563" }}>{t.field(field.key)}</span>
          <FieldInput
            field={field}
            value={values[field.key]}
            onCommit={(value) => onChange(withField(payload, field.key, value))}
          />
        </label>
      ))}
    </div>
  );
}

function TypeSelect(props: {
  value: string;
  types: readonly string[];
  label: (type: string) => string;
  onChange: (type: string) => void;
}) {
  const { readOnly } = useGraph();
  return (
    <select
      className="nodrag"
      aria-label="type"
      disabled={readOnly}
      style={{ ...inputStyle, fontWeight: 600 }}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.types.map((type) => (
        <option key={type} value={type}>
          {props.label(type)}
        </option>
      ))}
    </select>
  );
}

// ── Tarjeta común de nodo ─────────────────────────────────────────────────────

function NodeCard(props: {
  kind: keyof typeof KIND_COLOR;
  title: ReactNode;
  severity?: IssueSeverity;
  messages?: string[];
  hasTarget: boolean;
  hasSource: boolean;
  onDelete?: () => void;
  children: ReactNode;
}) {
  const { t, readOnly } = useGraph();
  const color = props.severity ? SEVERITY_COLOR[props.severity] : KIND_COLOR[props.kind];
  return (
    <div
      className={`rules-graph-node rules-graph-node--${props.kind}`}
      data-severity={props.severity}
      title={props.messages?.join("\n") || undefined}
      style={{
        width: NODE_WIDTH,
        boxSizing: "border-box",
        padding: 8,
        fontSize: 12,
        color: "#111827",
        background: props.kind === "draft" ? "#f9fafb" : "#fff",
        border: `2px ${props.kind === "draft" ? "dashed" : "solid"} ${color}`,
        borderRadius: 8,
        boxShadow: props.severity ? `0 0 0 3px ${color}33` : "0 1px 2px #0000001a",
      }}
    >
      {props.hasTarget ? <Handle type="target" position={Position.Left} /> : null}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            color,
            flex: 1,
          }}
        >
          {props.title}
        </span>
        {props.onDelete && !readOnly ? (
          <button
            type="button"
            className="nodrag"
            aria-label={t.ui("delete")}
            title={t.ui("delete")}
            onClick={props.onDelete}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "#6b7280",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        ) : null}
      </div>
      {props.children}
      {props.hasSource ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

// ── Nodos ─────────────────────────────────────────────────────────────────────

function TriggerNodeView({ data }: NodeProps<TriggerNode>) {
  const { doc, t, run } = useGraph();
  const ruleId = data.ruleId;
  return (
    <NodeCard
      kind="trigger"
      title={t.kind("trigger")}
      severity={data.severity}
      messages={data.messages}
      hasTarget={false}
      hasSource
    >
      <div style={{ display: "grid", gap: 4 }}>
        <label style={{ display: "grid", gap: 2 }}>
          <span style={{ color: "#4b5563" }}>{t.ui("ruleId")}</span>
          <FieldInput
            field={{ key: "ruleId", kind: "string" }}
            value={ruleId}
            onCommit={(value) =>
              run(() => {
                const next = String(value).trim();
                if (!next) throw new Error(t.ui("invalidId"));
                renameRule(doc, ruleId, next);
              })
            }
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          <label style={{ display: "grid", gap: 2 }}>
            <span style={{ color: "#4b5563" }}>{t.ui("priority")}</span>
            <FieldInput
              field={{ key: "priority", kind: "number" }}
              value={data.priority}
              onCommit={(value) => run(() => updateRule(doc, ruleId, { priority: Number(value) }))}
            />
          </label>
          <label style={{ display: "grid", gap: 2 }}>
            <span style={{ color: "#4b5563" }}>{t.ui("once")}</span>
            <FieldInput
              field={{ key: "once", kind: "boolean" }}
              value={data.once}
              onCommit={(value) => run(() => updateRule(doc, ruleId, { once: value === true }))}
            />
          </label>
        </div>
        <TypeSelect
          value={data.trigger.type}
          types={TRIGGER_TYPES}
          label={t.trigger}
          onChange={(type) => {
            if (!isTriggerType(type)) return;
            run(() => updateRule(doc, ruleId, { trigger: defaultTrigger(type, data.trigger) }));
          }}
        />
      </div>
      <Fields
        fields={TRIGGER_FIELDS[data.trigger.type]}
        payload={data.trigger}
        onChange={(trigger) => run(() => updateRule(doc, ruleId, { trigger }))}
      />
    </NodeCard>
  );
}

function ConditionNodeView({ id, data }: NodeProps<ConditionNode>) {
  const { doc, t, run } = useGraph();
  const save = (condition: RuleCondition) =>
    run(() => updateCondition(doc, data.ruleId, data.index, condition));
  return (
    <NodeCard
      kind="condition"
      title={t.kind("condition")}
      severity={data.severity}
      messages={data.messages}
      hasTarget
      hasSource
      onDelete={() => run(() => deleteNodeById(doc, id, data))}
    >
      <TypeSelect
        value={data.condition.type}
        types={CONDITION_TYPES}
        label={t.condition}
        onChange={(type) => {
          if (isConditionType(type)) save(defaultCondition(type, data.condition));
        }}
      />
      <Fields
        fields={CONDITION_FIELDS[data.condition.type]}
        payload={data.condition}
        onChange={save}
      />
    </NodeCard>
  );
}

function ActionNodeView({ id, data }: NodeProps<ActionNode>) {
  const { doc, t, run } = useGraph();
  const save = (action: RuleAction) => run(() => updateAction(doc, data.ruleId, data.path, action));
  return (
    <NodeCard
      kind="action"
      title={t.kind("action")}
      severity={data.severity}
      messages={data.messages}
      hasTarget
      hasSource={data.action.type === "delay"}
      onDelete={() => run(() => deleteNodeById(doc, id, data))}
    >
      <TypeSelect
        value={data.action.type}
        types={ACTION_TYPES}
        label={t.action}
        onChange={(type) => {
          if (isActionType(type)) save(defaultAction(type, data.action));
        }}
      />
      <Fields fields={ACTION_FIELDS[data.action.type]} payload={data.action} onChange={save} />
    </NodeCard>
  );
}

function DraftNodeView({ id, data }: NodeProps<DraftNode>) {
  const { t, updateDraft, deleteDraft } = useGraph();
  const payload = data.payload;
  return (
    <NodeCard
      kind="draft"
      title={`${t.kind(payload.kind)} · ${t.kind("draft")}`}
      messages={[t.ui("draftHint")]}
      hasTarget
      hasSource={false}
      onDelete={() => deleteDraft(id)}
    >
      {payload.kind === "condition" ? (
        <>
          <TypeSelect
            value={payload.condition.type}
            types={CONDITION_TYPES}
            label={t.condition}
            onChange={(type) => {
              if (!isConditionType(type)) return;
              updateDraft(id, {
                kind: "condition",
                condition: defaultCondition(type, payload.condition),
              });
            }}
          />
          <Fields
            fields={CONDITION_FIELDS[payload.condition.type]}
            payload={payload.condition}
            onChange={(condition) => updateDraft(id, { kind: "condition", condition })}
          />
        </>
      ) : (
        <>
          <TypeSelect
            value={payload.action.type}
            types={ACTION_TYPES}
            label={t.action}
            onChange={(type) => {
              if (!isActionType(type)) return;
              updateDraft(id, { kind: "action", action: defaultAction(type, payload.action) });
            }}
          />
          <Fields
            fields={ACTION_FIELDS[payload.action.type]}
            payload={payload.action}
            onChange={(action) => updateDraft(id, { kind: "action", action })}
          />
        </>
      )}
    </NodeCard>
  );
}

/** Borrado desde el botón × de un nodo: mismo camino que la tecla Supr. */
function deleteNodeById(doc: Y.Doc, id: string, data: RuleGraphNode["data"]) {
  applyGraphDeletion(doc, [{ id, data, position: { x: 0, y: 0 } } as RuleGraphNode], {
    nodes: [{ id }],
  });
}

const nodeTypes = {
  [RULE_NODE_TYPES.trigger]: TriggerNodeView,
  [RULE_NODE_TYPES.condition]: ConditionNodeView,
  [RULE_NODE_TYPES.action]: ActionNodeView,
  [RULE_DRAFT_NODE_TYPE]: DraftNodeView,
};

// ── Lienzo ────────────────────────────────────────────────────────────────────

/** Estado local de React Flow que no pertenece al doc: medidas, selección, arrastre. */
type LocalNodeState = {
  measured?: { width?: number; height?: number };
  selected?: boolean;
  dragging?: boolean;
  /** Solo si el usuario ha movido el nodo; si no, manda la maquetación automática. */
  position?: XYPosition;
};

const toolbarButton: CSSProperties = {
  fontSize: 12,
  padding: "4px 8px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  background: "#fff",
  color: "#111827",
  cursor: "pointer",
};

function RulesGraphCanvas(props: RulesGraphProps) {
  const { doc, issues, readOnly = false, onError, focusRuleId, onSelectRule } = props;
  const t = useMemo(() => createLabeler(props.labels), [props.labels]);
  const rules = useYjsRules(doc);
  const graph = useMemo(() => rulesToGraph(rules), [rules]);
  const ruleNodes = useMemo(() => applyIssues(graph.nodes, issues ?? []), [graph.nodes, issues]);

  const [drafts, setDrafts] = useState<DraftNode[]>([]);
  const [local, setLocal] = useState<Record<string, LocalNodeState>>({});
  const draftSeq = useRef(0);
  const flow = useRef<ReactFlowInstance<AnyNode> | null>(null);

  const run = useCallback(
    (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        if (onError) onError(error);
        else console.error(error);
      }
    },
    [onError],
  );

  const addDrafts = useCallback((payloads: DraftPayload[], near?: XYPosition) => {
    if (payloads.length === 0) return;
    setDrafts((current) => [
      ...current,
      ...payloads.map((payload, i): DraftNode => {
        draftSeq.current += 1;
        return {
          id: `draft/${draftSeq.current}`,
          type: RULE_DRAFT_NODE_TYPE,
          position: {
            x: (near?.x ?? -320) + 40 * i,
            y: (near?.y ?? 0) + 40 * i,
          },
          data: { kind: "draft", payload },
        };
      }),
    ]);
  }, []);

  const context = useMemo<GraphContextValue>(
    () => ({
      doc,
      t,
      readOnly,
      run,
      updateDraft: (id, payload) =>
        setDrafts((current) =>
          current.map((node) =>
            node.id === id ? { ...node, data: { kind: "draft", payload } } : node,
          ),
        ),
      deleteDraft: (id) => setDrafts((current) => current.filter((node) => node.id !== id)),
    }),
    [doc, t, readOnly, run],
  );

  const nodes = useMemo<AnyNode[]>(
    () =>
      [...ruleNodes, ...drafts].map((node) => {
        // Tamaño inicial estimado: permite pintar en servidor (SSR) antes de medir.
        const focused =
          focusRuleId !== undefined &&
          node.type !== RULE_DRAFT_NODE_TYPE &&
          (node as RuleGraphNode).data.ruleId === focusRuleId;
        const sized = {
          ...node,
          initialWidth: NODE_WIDTH,
          initialHeight: LAYOUT.rowHeight - 30,
          ...(focused ? { selected: true } : {}),
        };
        const state = local[node.id];
        if (!state) return sized as AnyNode;
        return {
          ...sized,
          position: state.position ?? node.position,
          measured: state.measured,
          selected: state.selected ?? sized.selected,
          dragging: state.dragging,
        } as AnyNode;
      }),
    [ruleNodes, drafts, local, focusRuleId],
  );
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const onNodesChange = useCallback((changes: NodeChange<AnyNode>[]) => {
    setLocal((current) => {
      let next = current;
      const patch = (id: string, value: Partial<LocalNodeState>) => {
        if (next === current) next = { ...current };
        next[id] = { ...next[id], ...value };
      };
      for (const change of changes) {
        if (change.type === "dimensions" && change.dimensions) {
          patch(change.id, { measured: change.dimensions });
        } else if (change.type === "position") {
          patch(change.id, {
            dragging: change.dragging,
            ...(change.position ? { position: change.position } : {}),
          });
        } else if (change.type === "select") {
          patch(change.id, { selected: change.selected });
        }
      }
      return next;
    });
  }, []);

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const source = nodesById.get(connection.source);
      const target = nodesById.get(connection.target);
      if (!source || !target || target.type !== RULE_DRAFT_NODE_TYPE) return false;
      if (source.type === RULE_DRAFT_NODE_TYPE) return false;
      return canConnectDraft(source as RuleGraphNode, (target as DraftNode).data.payload.kind);
    },
    [nodesById],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || !isValidConnection(connection)) return;
      const source = nodesById.get(connection.source) as RuleGraphNode;
      const draft = nodesById.get(connection.target) as DraftNode;
      run(() => {
        if (connectDraft(doc, source, draft.data.payload)) {
          setDrafts((current) => current.filter((node) => node.id !== draft.id));
        }
      });
    },
    [doc, isValidConnection, nodesById, readOnly, run],
  );

  const onDelete = useCallback(
    ({ nodes: deletedNodes, edges }: { nodes: AnyNode[]; edges: Edge[] }) => {
      if (readOnly) return;
      const draftIds = new Set(
        deletedNodes.filter((node) => node.type === RULE_DRAFT_NODE_TYPE).map((node) => node.id),
      );
      if (draftIds.size > 0)
        setDrafts((current) => current.filter((node) => !draftIds.has(node.id)));
      const firstTarget = edges.map((e) => nodesById.get(e.target)).find(Boolean);
      run(() => {
        const detached = applyGraphDeletion(doc, ruleNodes, {
          nodes: deletedNodes.filter((node) => !draftIds.has(node.id)),
          edges,
        });
        addDrafts(
          detached,
          firstTarget ? { x: firstTarget.position.x, y: firstTarget.position.y + 60 } : undefined,
        );
      });
    },
    [addDrafts, doc, nodesById, readOnly, ruleNodes, run],
  );

  // Centra la vista en la regla enfocada (al cambiar de regla o al montar el lienzo).
  const focusRule = useCallback(
    (instance: ReactFlowInstance<AnyNode> | null) => {
      if (!instance || focusRuleId === undefined) return;
      const ids = ruleNodes.filter((n) => n.data.ruleId === focusRuleId).map((n) => ({ id: n.id }));
      if (ids.length > 0) void instance.fitView({ nodes: ids, duration: 300, maxZoom: 1.2 });
    },
    // Solo al cambiar la regla enfocada: editar no debe mover la vista.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- omisión intencional de `ruleNodes`.
    [focusRuleId],
  );
  useEffect(() => {
    // Al cambiar de regla se olvida la selección local para que mande el foco.
    if (focusRuleId !== undefined) {
      setLocal((current) => {
        let next = current;
        for (const [id, state] of Object.entries(current)) {
          if (state.selected === undefined) continue;
          if (next === current) next = { ...current };
          next[id] = { ...state, selected: undefined };
        }
        return next;
      });
    }
    focusRule(flow.current);
  }, [focusRule, focusRuleId]);

  const newRule = () =>
    run(() => createRule(doc, { id: nextRuleId(doc), trigger: defaultTrigger("on_interact") }));

  const isEmpty = rules.length === 0 && drafts.length === 0;

  return (
    <GraphContext.Provider value={context}>
      <div
        className={["rules-graph", props.className].filter(Boolean).join(" ")}
        style={{ width: "100%", height: props.height ?? 600, position: "relative" }}
      >
        <ReactFlow<AnyNode>
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onDelete={onDelete}
          onInit={(instance) => {
            flow.current = instance;
            focusRule(instance);
          }}
          onNodeClick={(_, node) => {
            if (node.type !== RULE_DRAFT_NODE_TYPE) {
              onSelectRule?.((node as RuleGraphNode).data.ruleId);
            }
          }}
          isValidConnection={isValidConnection}
          nodesConnectable={!readOnly}
          elementsSelectable
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          defaultEdgeOptions={{ type: "smoothstep" }}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <Panel position="top-left">
            {readOnly ? (
              <span style={{ fontSize: 12, color: "#6b7280" }}>{t.ui("readOnly")}</span>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={toolbarButton} onClick={newRule}>
                  {t.ui("newRule")}
                </button>
                <button
                  type="button"
                  style={toolbarButton}
                  onClick={() =>
                    addDrafts([
                      { kind: "condition", condition: defaultCondition("item_in_inventory") },
                    ])
                  }
                >
                  {t.ui("newCondition")}
                </button>
                <button
                  type="button"
                  style={toolbarButton}
                  onClick={() =>
                    addDrafts([{ kind: "action", action: defaultAction("set_object_state") }])
                  }
                >
                  {t.ui("newAction")}
                </button>
              </div>
            )}
          </Panel>
          {isEmpty ? (
            <Panel position="top-center">
              <p style={{ marginTop: 48, fontSize: 13, color: "#6b7280" }}>{t.ui("empty")}</p>
            </Panel>
          ) : null}
        </ReactFlow>
      </div>
    </GraphContext.Provider>
  );
}

/**
 * Grafo de reglas (specs/09 §4.2): vista `trigger → condiciones → acciones`
 * sobre el mapa `rules` del doc Yjs. Necesita la hoja de estilos de React Flow
 * (`@xyflow/react/dist/style.css`) cargada por la app que lo monta. `<ReactFlow>`
 * crea su propio provider, lo que además permite pintarlo en servidor.
 */
export function RulesGraph(props: RulesGraphProps) {
  return <RulesGraphCanvas {...props} />;
}
