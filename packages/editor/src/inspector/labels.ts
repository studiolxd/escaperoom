import { formatLabel } from "../validation/labels";
import type { InspectorTargetKind } from "./target";

/**
 * Textos del inspector. Como el grafo de reglas y el panel del validador,
 * `packages/editor` no depende de next-intl: en `packages/web` salen del
 * namespace `Inspector.labels` de los seis catálogos. Un texto ausente cae a su
 * clave (el identificador técnico que el creador ve también en el JSON y el MCP).
 */
export type InspectorLabels = {
  kinds: Record<InspectorTargetKind, string>;
  /** Nombre de cada propiedad por su clave (`sprite`, `lockedBy`, `requiresSolved`…). */
  fields: Record<string, string>;
  /** Valores de enums y variantes (`first_click`, `world`, `on_interact`…). */
  options: Record<string, string>;
  /** Encabezado de cada grupo de textos ligados. */
  texts: { dialogs: string; hints: string; items: string };
  ui: {
    title: string;
    empty: string;
    puzzles: string;
    rules: string;
    missing: string;
    id: string;
    rename: string;
    /** `{count}`: referencias reescritas. */
    renamed: string;
    delete: string;
    close: string;
    rulesTouching: string;
    noRules: string;
    openInGraph: string;
    /** Dónde toca la regla: en el trigger, condiciones y acciones (`{count}`). */
    inTrigger: string;
    inConditions: string;
    inActions: string;
    referencedBy: string;
    linkedTexts: string;
    template: string;
    templatePending: string;
    graphHint: string;
    add: string;
    remove: string;
    unset: string;
    none: string;
    yes: string;
    no: string;
    key: string;
    newKey: string;
    invalidJson: string;
    language: string;
  };
  errors: Record<string, string>;
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type InspectorLabelsInput = DeepPartial<InspectorLabels>;

export function createInspectorLabeler(labels: InspectorLabelsInput | undefined) {
  const pick = (group: Record<string, string | undefined> | undefined, key: string) =>
    group?.[key] ?? key;
  return {
    kind: (kind: InspectorTargetKind) => pick(labels?.kinds, kind),
    field: (key: string) => pick(labels?.fields, key),
    option: (value: string) => pick(labels?.options, value),
    texts: (group: keyof InspectorLabels["texts"]) => pick(labels?.texts, group),
    ui: (key: keyof InspectorLabels["ui"], values: Record<string, string | number> = {}) =>
      formatLabel(pick(labels?.ui, key), values),
    /** Mensaje de un error de dominio por `code`; sin traducción, el mensaje técnico. */
    error: (code: string, fallback: string) => labels?.errors?.[code] ?? fallback,
  };
}

export type InspectorLabeler = ReturnType<typeof createInspectorLabeler>;
