import type { ValidationCheckId } from "@escaperoom/shared/validator";
import type { ValidationTargetKind } from "./findings";

/**
 * Textos del panel de avisos. Como el grafo de reglas, `packages/editor` no
 * depende de next-intl: en `packages/web` salen del namespace
 * `ValidationPanel.labels` de los seis catálogos. Un texto ausente cae a su
 * clave. Los `{marcadores}` se sustituyen con `formatLabel`.
 *
 * Los mensajes de cada hallazgo son los del validador (en español, iguales
 * para el editor humano, el MCP y `POST /validate`); el panel traduce su
 * contexto: título del check, tipo de elemento, estados y estimación.
 */
export type ValidationPanelLabels = {
  ui: {
    title: string;
    idle: string;
    validating: string;
    upToDate: string;
    publishable: string;
    blocked: string;
    invalidDraft: string;
    errors: string;
    warnings: string;
    noIssues: string;
    /** `{counts}`: tamaños de grupo afectados (`1, 2`). */
    playerCounts: string;
    estimate: string;
    /** `{minutes}`, `{min}`, `{max}`, `{players}`, `{steps}`. */
    estimateValue: string;
    /** `{declared}`, `{expected}`. */
    difficulty: string;
    /** `{players}`. */
    route: string;
    noRoute: string;
  };
  checks: Record<ValidationCheckId, string>;
  kinds: Record<ValidationTargetKind, string>;
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ValidationPanelLabelsInput = DeepPartial<ValidationPanelLabels>;

/** Sustituye `{clave}` por su valor; deja intactos los marcadores sin valor. */
export function formatLabel(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export function createValidationLabeler(labels: ValidationPanelLabelsInput | undefined) {
  const pick = (group: Record<string, string | undefined> | undefined, key: string) =>
    group?.[key] ?? key;
  return {
    ui: (key: keyof ValidationPanelLabels["ui"], values: Record<string, string | number> = {}) =>
      formatLabel(pick(labels?.ui, key), values),
    check: (id: ValidationCheckId) => pick(labels?.checks, id),
    kind: (kind: ValidationTargetKind) => pick(labels?.kinds, kind),
  };
}
