import type { ActionType, ConditionType, TriggerType } from "./vocabulary";

/**
 * Textos de la UI del grafo. `packages/editor` no depende de next-intl: quien
 * monta el componente le pasa este diccionario (en `packages/web` sale del
 * namespace `RulesGraph.labels` de los catálogos, ver `README.md`).
 *
 * Todo es opcional: un texto ausente cae al identificador técnico (`on_interact`,
 * `objectId`…), que es el mismo que ve el creador en el JSON y en el MCP.
 */
export type RulesGraphLabels = {
  kinds: { trigger: string; condition: string; action: string; draft: string };
  triggers: Record<TriggerType, string>;
  conditions: Record<ConditionType, string>;
  actions: Record<ActionType, string>;
  /** Nombre de cada campo del payload (`objectId`, `itemId`, `seconds`…). */
  fields: Record<string, string>;
  ui: {
    ruleId: string;
    priority: string;
    once: string;
    yes: string;
    no: string;
    unset: string;
    delete: string;
    newRule: string;
    newCondition: string;
    newAction: string;
    empty: string;
    readOnly: string;
    draftHint: string;
    invalidId: string;
  };
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type RulesGraphLabelsInput = DeepPartial<RulesGraphLabels>;

/** Resolutor tolerante: devuelve el texto o, si falta, el identificador. */
export function createLabeler(labels: RulesGraphLabelsInput | undefined) {
  const pick = (group: Record<string, string | undefined> | undefined, key: string) =>
    group?.[key] ?? key;
  return {
    kind: (key: keyof RulesGraphLabels["kinds"]) => pick(labels?.kinds, key),
    trigger: (key: string) => pick(labels?.triggers, key),
    condition: (key: string) => pick(labels?.conditions, key),
    action: (key: string) => pick(labels?.actions, key),
    field: (key: string) => pick(labels?.fields, key),
    ui: (key: keyof RulesGraphLabels["ui"]) => pick(labels?.ui, key),
  };
}

export type Labeler = ReturnType<typeof createLabeler>;
