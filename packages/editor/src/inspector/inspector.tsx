"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type * as Y from "yjs";
import type { PuzzleDefinition, RoomPackage } from "@escaperoom/shared/schemas";
import { getLocalizedField } from "../i18n-fields/fields";
import {
  getLocalizedValue,
  setLocalizedValue,
  type YLocalizedText,
} from "../i18n-fields/localized-text";
import { RoomDocError } from "../room-doc/commands";
import { useRoomPackage } from "../room-doc/use-room-package";
import { RulesDocError } from "../rules-graph/yjs-rules";
import {
  describeTarget,
  idOptions,
  inspectElement,
  setElementProperty,
  type InspectedElement,
  type LinkedText,
} from "./inspector-model";
import { createInspectorLabeler, type InspectorLabeler, type InspectorLabelsInput } from "./labels";
import type { RuleTouch } from "./references";
import { renameElement } from "./rename";
import type { FieldKindDefinition } from "./schema-form";
import {
  CommitInput,
  SchemaForm,
  smallButtonStyle,
  type FieldRenderer,
  type SchemaFormContext,
} from "./schema-form-view";
import { InspectorError, type InspectorTarget } from "./target";

/** Lo que recibe el slot de un texto localizado ligado al elemento. */
export type LinkedTextSlotProps = {
  collection: LinkedText["collection"];
  id: string;
  /** Campo `LocalizedText` del doc (el `text` del diálogo/pista, el `name` del ítem). */
  text: YLocalizedText;
  languages: readonly string[];
  defaultLanguage: string;
  /** Etiqueta ya traducida (`Diálogo · d-cuadro`). */
  label: string;
  /** Diálogos y pistas llevan audio por idioma (3.11); los ítems no. */
  audio: boolean;
};

/** Slot del configurador de la plantilla (3.5). */
export type PuzzleConfiguratorSlotProps = { doc: Y.Doc; puzzle: PuzzleDefinition };

export type InspectorProps = {
  /** Doc Yjs de la sala: el inspector lee y escribe en él. */
  doc: Y.Doc;
  /** Elemento seleccionado; `null` muestra la lista de puzzles y reglas. */
  target: InspectorTarget | null;
  labels?: InspectorLabelsInput;
  /** Cambio de selección (lista, referencias, tras renombrar). */
  onSelect?: (target: InspectorTarget | null) => void;
  /** «Ver en el grafo»: el host enseña la regla en el grafo de reglas (3.6). */
  onOpenRule?: (ruleId: string) => void;
  /** Borrar el elemento (el host decide cómo; p. ej. `controller.deleteSelection()`). */
  onDelete?: (target: InspectorTarget) => void;
  /**
   * Campo de un texto localizado (3.10) con su audio (3.11). Sin él se pinta un
   * campo mínimo por idioma.
   */
  renderLocalizedText?: (props: LinkedTextSlotProps) => ReactNode;
  /** Configurador de la plantilla del puzzle (3.5). */
  renderPuzzleConfigurator?: (props: PuzzleConfiguratorSlotProps) => ReactNode;
  /** Tipos de campo registrados en el generador y sus renderers. */
  fieldKinds?: readonly FieldKindDefinition[];
  renderers?: Readonly<Record<string, FieldRenderer>>;
  readOnly?: boolean;
  className?: string;
  style?: CSSProperties;
};

type ErrorState = { code: string; message: string } | null;

function toErrorState(error: unknown): { code: string; message: string } {
  if (error instanceof InspectorError || error instanceof RoomDocError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof RulesDocError) return { code: "RULES", message: error.message };
  return { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) };
}

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const headingStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  margin: 0,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  opacity: 0.8,
};
const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const chipStyle: CSSProperties = { ...smallButtonStyle, fontFamily: "ui-monospace, monospace" };
const mutedStyle: CSSProperties = { fontSize: 12, opacity: 0.65, margin: 0 };
const errorStyle: CSSProperties = { fontSize: 12, color: "#f87171", margin: 0 };

/**
 * Inspector de propiedades (specs/09 §4.1): panel contextual del objeto,
 * puzzle o regla seleccionado. Es genérico: el formulario sale del esquema Zod
 * del elemento (`describeTarget` → `<SchemaForm>`), no hay un componente por
 * tipo. Lee la sala con `useRoomPackage` y escribe en el doc Yjs, así que un
 * cambio de otra pestaña o del MCP se ve sin lógica extra.
 */
export function Inspector(props: InspectorProps) {
  const { doc, target, onSelect } = props;
  const t = useMemo(() => createInspectorLabeler(props.labels), [props.labels]);
  const pkg = useRoomPackage(doc);
  const [renamed, setRenamed] = useState<{ id: string; notice: string } | null>(null);

  if (!target) return <ElementBrowser pkg={pkg} t={t} onSelect={onSelect} {...props} />;
  const element = inspectElement(pkg, target);
  return (
    <section
      className={["inspector", props.className].filter(Boolean).join(" ")}
      style={{ ...sectionStyle, gap: 14, ...props.style }}
      data-inspector={target.kind}
      data-inspector-id={target.id}
    >
      {element ? (
        <InspectorBody
          key={`${target.kind}:${target.id}`}
          {...props}
          target={target}
          pkg={pkg}
          element={element}
          t={t}
          renameNotice={renamed?.id === target.id ? renamed.notice : null}
          onRenamed={(next, notice) => {
            setRenamed({ id: next.id, notice });
            onSelect?.(next);
          }}
        />
      ) : (
        <>
          <p style={mutedStyle}>{t.ui("missing")}</p>
          {onSelect ? (
            <div>
              <button type="button" style={smallButtonStyle} onClick={() => onSelect(null)}>
                {t.ui("close")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ElementBrowser(
  props: InspectorProps & {
    pkg: RoomPackage;
    t: InspectorLabeler;
  },
) {
  const { pkg, t, onSelect } = props;
  const group = (kind: "puzzle" | "rule", ids: string[]) => (
    <div style={sectionStyle}>
      <h3 style={headingStyle}>{t.ui(kind === "puzzle" ? "puzzles" : "rules")}</h3>
      <ul style={{ ...listStyle, flexDirection: "row", flexWrap: "wrap" }}>
        {ids.map((id) => (
          <li key={id}>
            <button
              type="button"
              style={chipStyle}
              data-select-kind={kind}
              data-select-id={id}
              disabled={!onSelect}
              onClick={() => onSelect?.({ kind, id })}
            >
              {id}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section
      className={["inspector", props.className].filter(Boolean).join(" ")}
      style={{ ...sectionStyle, gap: 14, ...props.style }}
      data-inspector="none"
    >
      <p style={mutedStyle}>{t.ui("empty")}</p>
      {pkg.puzzles.length > 0
        ? group(
            "puzzle",
            pkg.puzzles.map((p) => p.id),
          )
        : null}
      {pkg.rules.length > 0
        ? group(
            "rule",
            pkg.rules.map((r) => r.id),
          )
        : null}
    </section>
  );
}

function RenameForm({
  doc,
  target,
  t,
  readOnly,
  notice,
  onRenamed,
}: {
  doc: Y.Doc;
  target: InspectorTarget;
  t: InspectorLabeler;
  readOnly: boolean;
  /** Aviso del último renombrado (vive fuera: renombrar remonta el cuerpo). */
  notice: string | null;
  onRenamed: (target: InspectorTarget, notice: string) => void;
}) {
  const [error, setError] = useState<ErrorState>(null);
  return (
    <div style={sectionStyle} data-rename="">
      <span style={{ fontSize: 11, opacity: 0.75 }}>{t.ui("id")}</span>
      <CommitInput
        value={target.id}
        mono
        disabled={readOnly}
        aria-label={t.ui("rename")}
        onCommit={(next) => {
          const newId = next.trim();
          if (!newId || newId === target.id) return;
          try {
            const result = renameElement(doc, target, newId);
            setError(null);
            onRenamed(
              { kind: target.kind, id: result.id },
              t.ui("renamed", { count: result.rewritten.length }),
            );
          } catch (caught) {
            setError(toErrorState(caught));
          }
        }}
      />
      {error ? (
        <p role="alert" style={errorStyle}>
          {t.error(error.code, error.message)}
        </p>
      ) : notice ? (
        <p role="status" style={mutedStyle}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function touchSummary(touch: RuleTouch, t: InspectorLabeler): string {
  const parts: string[] = [];
  if (touch.trigger) parts.push(t.ui("inTrigger"));
  if (touch.conditions.length > 0)
    parts.push(t.ui("inConditions", { count: touch.conditions.length }));
  if (touch.actions.length > 0) parts.push(t.ui("inActions", { count: touch.actions.length }));
  return parts.join(" · ");
}

function RulesTouching({
  rules,
  t,
  onSelect,
  onOpenRule,
}: {
  rules: RuleTouch[];
  t: InspectorLabeler;
  onSelect?: (target: InspectorTarget) => void;
  onOpenRule?: (ruleId: string) => void;
}) {
  return (
    <div style={sectionStyle} data-rules-touching={rules.length}>
      <h3 style={headingStyle}>{t.ui("rulesTouching")}</h3>
      {rules.length === 0 ? (
        <p style={mutedStyle}>{t.ui("noRules")}</p>
      ) : (
        <ul style={listStyle}>
          {rules.map((touch) => (
            <li
              key={touch.ruleId}
              data-rule={touch.ruleId}
              style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}
            >
              <button
                type="button"
                style={chipStyle}
                disabled={!onSelect}
                onClick={() => onSelect?.({ kind: "rule", id: touch.ruleId })}
              >
                {touch.ruleId}
              </button>
              <span style={{ fontSize: 11, opacity: 0.7 }}>{touchSummary(touch, t)}</span>
              {onOpenRule ? (
                <button
                  type="button"
                  style={{ ...smallButtonStyle, marginLeft: "auto" }}
                  data-open-rule={touch.ruleId}
                  onClick={() => onOpenRule(touch.ruleId)}
                >
                  {t.ui("openInGraph")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Campo mínimo por idioma (si el host no monta el de 3.10). */
function LocalizedTextFallback({ text, languages, label }: LinkedTextSlotProps) {
  return (
    <div style={sectionStyle} data-localized-fallback="">
      <span style={{ fontSize: 11, opacity: 0.75 }}>{label}</span>
      {languages.map((locale) => (
        <label key={locale} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <code style={{ fontSize: 11, width: 24 }}>{locale}</code>
          <CommitInput
            value={getLocalizedValue(text, locale)}
            aria-label={`${label} (${locale})`}
            onCommit={(next) => setLocalizedValue(text, locale, next)}
          />
        </label>
      ))}
    </div>
  );
}

function LinkedTexts({
  doc,
  pkg,
  texts,
  t,
  render,
}: {
  doc: Y.Doc;
  pkg: RoomPackage;
  texts: LinkedText[];
  t: InspectorLabeler;
  render?: (props: LinkedTextSlotProps) => ReactNode;
}) {
  if (texts.length === 0) return null;
  const { languages, defaultLanguage } = pkg.meta;
  return (
    <div style={sectionStyle} data-linked-texts={texts.length}>
      <h3 style={headingStyle}>{t.ui("linkedTexts")}</h3>
      {texts.map((linked) => {
        const text = getLocalizedField(doc, linked.collection, linked.id);
        if (!text) return null;
        const slot: LinkedTextSlotProps = {
          collection: linked.collection,
          id: linked.id,
          text,
          languages,
          defaultLanguage,
          label: `${t.texts(linked.collection)} · ${linked.id}`,
          audio: linked.collection !== "items",
        };
        return (
          <div key={`${linked.collection}:${linked.id}`} data-linked-text={linked.id}>
            {render ? render(slot) : <LocalizedTextFallback {...slot} />}
          </div>
        );
      })}
    </div>
  );
}

function InspectorBody(
  props: InspectorProps & {
    target: InspectorTarget;
    pkg: RoomPackage;
    element: InspectedElement;
    t: InspectorLabeler;
    renameNotice: string | null;
    onRenamed: (target: InspectorTarget, notice: string) => void;
  },
) {
  const { doc, target, pkg, element, t, onSelect, onOpenRule, onDelete } = props;
  const readOnly = props.readOnly ?? false;
  const [error, setError] = useState<ErrorState>(null);
  const puzzleType =
    target.kind === "puzzle" ? (element.value as PuzzleDefinition).type : undefined;
  const kinds = useMemo(() => props.fieldKinds ?? [], [props.fieldKinds]);
  const root = useMemo(
    () => describeTarget(target.kind, puzzleType, { kinds }),
    [target.kind, puzzleType, kinds],
  );
  const ctx: SchemaFormContext = {
    t,
    idOptions: (ref) => idOptions(pkg, ref, element.value),
    kinds,
    renderers: props.renderers ?? {},
    readOnly,
  };

  const onPropertyChange = (key: string, value: unknown) => {
    try {
      setElementProperty(doc, target, key, value);
      setError(null);
    } catch (caught) {
      setError(toErrorState(caught));
    }
  };

  return (
    <>
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t.kind(target.kind)}</h2>
        {onSelect ? (
          <button
            type="button"
            style={{ ...smallButtonStyle, marginLeft: "auto" }}
            onClick={() => onSelect(null)}
          >
            {t.ui("close")}
          </button>
        ) : null}
      </header>

      <RenameForm
        doc={doc}
        target={target}
        t={t}
        readOnly={readOnly}
        notice={props.renameNotice}
        onRenamed={props.onRenamed}
      />

      <SchemaForm
        root={root}
        value={element.value as unknown as Record<string, unknown>}
        onPropertyChange={onPropertyChange}
        ctx={ctx}
      />
      {error ? (
        <p role="alert" style={errorStyle}>
          {t.error(error.code, error.message)}
        </p>
      ) : null}

      {target.kind === "puzzle" ? (
        <div style={sectionStyle} data-puzzle-configurator={puzzleType}>
          <h3 style={headingStyle}>{t.ui("template")}</h3>
          {props.renderPuzzleConfigurator ? (
            props.renderPuzzleConfigurator({ doc, puzzle: element.value as PuzzleDefinition })
          ) : (
            <p style={mutedStyle}>{t.ui("templatePending")}</p>
          )}
        </div>
      ) : null}

      {target.kind === "rule" ? (
        <div style={sectionStyle}>
          <p style={mutedStyle}>{t.ui("graphHint")}</p>
          {onOpenRule ? (
            <div>
              <button
                type="button"
                style={smallButtonStyle}
                data-open-rule={target.id}
                onClick={() => onOpenRule(target.id)}
              >
                {t.ui("openInGraph")}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <RulesTouching
          rules={element.rules}
          t={t}
          onSelect={onSelect ?? undefined}
          onOpenRule={onOpenRule}
        />
      )}

      {element.referencedBy.length > 0 ? (
        <div style={sectionStyle}>
          <h3 style={headingStyle}>{t.ui("referencedBy")}</h3>
          <ul style={{ ...listStyle, flexDirection: "row", flexWrap: "wrap" }}>
            {element.referencedBy.map((ref) => (
              <li key={`${ref.kind}:${ref.id}`}>
                <button
                  type="button"
                  style={chipStyle}
                  data-reference={ref.id}
                  disabled={!onSelect}
                  onClick={() => onSelect?.(ref)}
                >
                  {t.kind(ref.kind)}: {ref.id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <LinkedTexts
        doc={doc}
        pkg={pkg}
        texts={element.texts}
        t={t}
        render={props.renderLocalizedText}
      />

      {onDelete && !readOnly ? (
        <div>
          <button
            type="button"
            style={{ ...smallButtonStyle, borderColor: "#dc2626", color: "#f87171" }}
            onClick={() => onDelete(target)}
          >
            {t.ui("delete")}
          </button>
        </div>
      ) : null}
    </>
  );
}
