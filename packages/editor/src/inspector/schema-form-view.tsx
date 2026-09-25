"use client";

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_UI_KIT, type EditorUiKit } from "../ui-kit";
import type { InspectorLabeler } from "./labels";
import type { RefKind } from "./references";
import {
  defaultValueFor,
  matchVariant,
  type FieldKindDefinition,
  type FormField,
} from "./schema-form";

/**
 * Pintado genérico de un árbol `FormField` (el de `describeSchema`). Cada tipo
 * de campo tiene un renderer; el host puede añadir o sustituir renderers por
 * `kind` (`renderers`), igual que registra tipos en el generador.
 */

export type SchemaFormContext = {
  t: InspectorLabeler;
  /** Ids existentes para un campo con `ref`. */
  idOptions: (ref: RefKind) => readonly string[];
  /** Tipos registrados (para los valores por defecto al añadir elementos). */
  kinds: readonly FieldKindDefinition[];
  /** Renderers del host por `kind`; lo que no esté usa `BUILTIN_RENDERERS`. */
  renderers: Readonly<Record<string, FieldRenderer>>;
  readOnly: boolean;
  /** Controles interactivos del host (auditoría F-6); por defecto, elemento nativo. */
  uiKit: EditorUiKit;
};

export type FieldRendererProps = {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  ctx: SchemaFormContext;
  /** Pinta un campo hijo (para renderers de contenedores). */
  renderField: (field: FormField, value: unknown, onChange: (value: unknown) => void) => ReactNode;
  /** Id del control, para asociar la etiqueta. */
  inputId: string;
};

export type FieldRenderer = (props: FieldRendererProps) => ReactNode;

// ── Estilos (inline; el host ajusta colores con variables CSS) ──────────────

export const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontSize: 12,
  padding: "3px 6px",
  borderRadius: 4,
  border: "1px solid var(--inspector-border, rgba(127,127,127,.45))",
  background: "var(--inspector-input-bg, transparent)",
  color: "inherit",
};
const monoStyle: CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 12 };
export const smallButtonStyle: CSSProperties = {
  fontSize: 11,
  padding: "1px 6px",
  borderRadius: 4,
  border: "1px solid var(--inspector-border, rgba(127,127,127,.45))",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};
const groupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  paddingLeft: 8,
  borderLeft: "2px solid var(--inspector-border, rgba(127,127,127,.3))",
};
const rowStyle: CSSProperties = { display: "flex", gap: 4, alignItems: "flex-start" };
const labelStyle: CSSProperties = { fontSize: 11, opacity: 0.75 };

// ── Controles básicos ───────────────────────────────────────────────────────

/**
 * Input que confirma al salir o con Intro: escribir no genera una transacción
 * Yjs por tecla, y un cambio remoto del valor se refleja si no se está editando.
 */
export function CommitInput(props: {
  value: string;
  onCommit: (value: string) => void;
  id?: string;
  type?: "text" | "number";
  step?: number;
  min?: number;
  list?: string;
  disabled?: boolean;
  mono?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  /** Control del host (auditoría F-6); por defecto, `<input>` nativo. */
  Input?: EditorUiKit["Input"];
}) {
  const { value, onCommit, mono, Input = DEFAULT_UI_KIT.Input, ...rest } = props;
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      {...rest}
      style={{ ...inputStyle, ...(mono ? monoStyle : {}) }}
      value={draft}
      spellCheck={false}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        setEditing(true);
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          setEditing(false);
          setDraft(value);
        }
      }}
    />
  );
}

function asString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

const TextRenderer: FieldRenderer = ({ field, value, onChange, ctx, inputId }) => {
  const current = asString(value);
  const disabled = ctx.readOnly || field.readOnly;
  if (field.ref) {
    const options = [...ctx.idOptions(field.ref)];
    if (current && !options.includes(current)) options.unshift(current);
    return (
      <ctx.uiKit.Select
        id={inputId}
        className="w-full font-mono"
        style={{ ...inputStyle, ...monoStyle }}
        value={current}
        disabled={disabled}
        placeholder={field.optional || current === "" ? ctx.t.ui("none") : undefined}
        options={options.map((id) => ({ value: id, label: id }))}
        onValueChange={(next) => onChange(next === "" && field.optional ? undefined : next)}
      />
    );
  }
  const listId = field.suggestions ? `${inputId}-list` : undefined;
  return (
    <>
      <CommitInput
        id={inputId}
        value={current}
        list={listId}
        disabled={disabled}
        Input={ctx.uiKit.Input}
        onCommit={(next) => onChange(next === "" && field.optional ? undefined : next)}
      />
      {listId ? (
        <datalist id={listId}>
          {field.suggestions?.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </>
  );
};

const NumberRenderer: FieldRenderer = ({ field, value, onChange, ctx, inputId }) => (
  <CommitInput
    id={inputId}
    type="number"
    step={field.integer ? 1 : undefined}
    min={field.min}
    value={asString(value)}
    disabled={ctx.readOnly || field.readOnly}
    Input={ctx.uiKit.Input}
    onCommit={(next) => {
      if (next.trim() === "") {
        if (field.optional) onChange(undefined);
        return;
      }
      const parsed = Number(next);
      if (Number.isFinite(parsed)) onChange(field.integer ? Math.trunc(parsed) : parsed);
    }}
  />
);

const BooleanRenderer: FieldRenderer = ({ field, value, onChange, ctx, inputId }) => (
  <ctx.uiKit.Checkbox
    id={inputId}
    checked={value === true}
    disabled={ctx.readOnly || field.readOnly}
    onCheckedChange={onChange}
  />
);

const EnumRenderer: FieldRenderer = ({ field, value, onChange, ctx, inputId }) => (
  <ctx.uiKit.Select
    id={inputId}
    className="w-full"
    style={inputStyle}
    value={asString(value)}
    disabled={ctx.readOnly || field.readOnly}
    placeholder={field.optional || value === undefined ? ctx.t.ui("none") : undefined}
    options={(field.options ?? []).map((option) => ({ value: option, label: ctx.t.option(option) }))}
    onValueChange={(next) => onChange(next === "" && field.optional ? undefined : next)}
  />
);

const LiteralRenderer: FieldRenderer = ({ field, ctx }) => (
  <code style={monoStyle} data-literal={String(field.value)}>
    {ctx.t.option(String(field.value))}
  </code>
);

const ObjectRenderer: FieldRenderer = ({ field, value, onChange, renderField }) => {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return (
    <div style={groupStyle}>
      {field.fields?.map((child) =>
        renderField(child, record[child.key], (next) => {
          const copy = { ...record };
          if (next === undefined) delete copy[child.key];
          else copy[child.key] = next;
          onChange(copy);
        }),
      )}
    </div>
  );
};

const ListRenderer: FieldRenderer = ({ field, value, onChange, ctx, renderField }) => {
  const items = Array.isArray(value) ? value : [];
  const item = field.item as FormField;
  const disabled = ctx.readOnly || field.readOnly;
  return (
    <div style={groupStyle} data-list={field.path.join(".")}>
      {items.map((entry, index) => (
        <div key={index} style={rowStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {renderField(item, entry, (next) => {
              const copy = [...items];
              copy[index] = next;
              onChange(copy);
            })}
          </div>
          {disabled ? null : (
            <ctx.uiKit.Button
              type="button"
              style={smallButtonStyle}
              aria-label={ctx.t.ui("remove")}
              title={ctx.t.ui("remove")}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              ×
            </ctx.uiKit.Button>
          )}
        </div>
      ))}
      {disabled ? null : (
        <div>
          <ctx.uiKit.Button
            type="button"
            style={smallButtonStyle}
            onClick={() => onChange([...items, defaultValueFor(item, ctx.kinds)])}
          >
            + {ctx.t.ui("add")}
          </ctx.uiKit.Button>
        </div>
      )}
    </div>
  );
};

function NewKeyForm({ onAdd, ctx }: { onAdd: (key: string) => void; ctx: SchemaFormContext }) {
  const [key, setKey] = useState("");
  return (
    <div style={rowStyle}>
      <ctx.uiKit.Input
        style={{ ...inputStyle, ...monoStyle }}
        value={key}
        placeholder={ctx.t.ui("newKey")}
        aria-label={ctx.t.ui("newKey")}
        onChange={(event) => setKey(event.target.value)}
      />
      <ctx.uiKit.Button
        type="button"
        style={smallButtonStyle}
        disabled={key.trim() === ""}
        onClick={() => {
          onAdd(key.trim());
          setKey("");
        }}
      >
        + {ctx.t.ui("add")}
      </ctx.uiKit.Button>
    </div>
  );
}

const RecordRenderer: FieldRenderer = ({ field, value, onChange, ctx, renderField }) => {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const valueField = field.valueField as FormField;
  const disabled = ctx.readOnly || field.readOnly;
  const entries = Object.entries(record);
  const renameKey = (from: string, to: string) => {
    if (!to || to === from || to in record) return;
    onChange(Object.fromEntries(entries.map(([k, v]) => [k === from ? to : k, v])));
  };
  return (
    <div style={groupStyle} data-record={field.path.join(".")}>
      {entries.map(([key, entry]) => (
        <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={rowStyle}>
            <CommitInput
              value={key}
              mono
              disabled={disabled}
              aria-label={ctx.t.ui("key")}
              Input={ctx.uiKit.Input}
              onCommit={(next) => renameKey(key, next.trim())}
            />
            {disabled ? null : (
              <ctx.uiKit.Button
                type="button"
                style={smallButtonStyle}
                aria-label={ctx.t.ui("remove")}
                title={ctx.t.ui("remove")}
                onClick={() => onChange(Object.fromEntries(entries.filter(([k]) => k !== key)))}
              >
                ×
              </ctx.uiKit.Button>
            )}
          </div>
          {renderField(valueField, entry, (next) => onChange({ ...record, [key]: next }))}
        </div>
      ))}
      {disabled ? null : (
        <NewKeyForm
          ctx={ctx}
          onAdd={(key) => {
            if (key in record) return;
            onChange({ ...record, [key]: defaultValueFor(valueField, ctx.kinds) });
          }}
        />
      )}
    </div>
  );
};

const UnionRenderer: FieldRenderer = ({ field, value, onChange, ctx, renderField, inputId }) => {
  const variant = matchVariant(field, value);
  if (!variant) return null;
  const disabled = ctx.readOnly || field.readOnly;
  // En una unión discriminada el discriminador es el selector: no se repite dentro.
  const inner: FormField =
    field.discriminator && variant.field.fields
      ? {
          ...variant.field,
          fields: variant.field.fields.filter((f) => f.key !== field.discriminator),
        }
      : variant.field;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-variant={variant.value}>
      {(field.variants?.length ?? 0) > 1 ? (
        <ctx.uiKit.Select
          id={inputId}
          style={inputStyle}
          value={variant.value}
          disabled={disabled}
          options={(field.variants ?? []).map((v) => ({ value: v.value, label: ctx.t.option(v.value) }))}
          onValueChange={(next) => {
            const variantField = field.variants?.find((v) => v.value === next);
            if (variantField) onChange(defaultValueFor(variantField.field, ctx.kinds));
          }}
        />
      ) : null}
      {inner.kind === "object" && (inner.fields?.length ?? 0) === 0
        ? null
        : renderField({ ...inner, key: "" }, value, onChange)}
    </div>
  );
};

const JsonRenderer: FieldRenderer = ({ field, value, onChange, ctx, inputId }) => {
  const text = value === undefined ? "" : JSON.stringify(value, null, 1);
  const [draft, setDraft] = useState(text);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(text), [text]);
  return (
    <>
      <ctx.uiKit.Textarea
        id={inputId}
        style={{ ...inputStyle, ...monoStyle, minHeight: 48 }}
        value={draft}
        disabled={ctx.readOnly || field.readOnly}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft.trim() === "" && field.optional) return onChange(undefined);
          try {
            const parsed: unknown = JSON.parse(draft);
            setInvalid(false);
            if (draft !== text) onChange(parsed);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid ? (
        <span style={{ fontSize: 11, color: "#dc2626" }}>{ctx.t.ui("invalidJson")}</span>
      ) : null}
    </>
  );
};

export const BUILTIN_RENDERERS: Readonly<Record<string, FieldRenderer>> = {
  text: TextRenderer,
  number: NumberRenderer,
  boolean: BooleanRenderer,
  enum: EnumRenderer,
  literal: LiteralRenderer,
  object: ObjectRenderer,
  list: ListRenderer,
  record: RecordRenderer,
  union: UnionRenderer,
  json: JsonRenderer,
  localizedText: JsonRenderer,
};

const CONTAINERS = new Set(["object", "list", "record", "union"]);

function FieldView({
  field,
  value,
  onChange,
  ctx,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  ctx: SchemaFormContext;
}) {
  const inputId = useId();
  const Renderer = (ctx.renderers[field.kind] ??
    BUILTIN_RENDERERS[field.kind] ??
    BUILTIN_RENDERERS.json) as FieldRenderer;
  const renderField = (
    child: FormField,
    childValue: unknown,
    childChange: (v: unknown) => void,
  ) => (
    <FieldView
      key={child.path.join(".") + child.key}
      field={child}
      value={childValue}
      onChange={childChange}
      ctx={ctx}
    />
  );
  const disabled = ctx.readOnly || field.readOnly;
  const absent = value === undefined;
  // Un contenedor opcional ausente se crea con su valor por defecto.
  const body =
    absent && field.optional && CONTAINERS.has(field.kind) ? (
      disabled ? (
        <span style={{ fontSize: 11, opacity: 0.6 }}>{ctx.t.ui("unset")}</span>
      ) : (
        <div>
          <ctx.uiKit.Button
            type="button"
            style={smallButtonStyle}
            onClick={() => onChange(defaultValueFor(field, ctx.kinds))}
          >
            + {ctx.t.ui("add")}
          </ctx.uiKit.Button>
        </div>
      )
    ) : (
      <Renderer
        field={field}
        value={value}
        onChange={onChange}
        ctx={ctx}
        renderField={renderField}
        inputId={inputId}
      />
    );

  if (!field.key) return <>{body}</>;
  const inline = field.kind === "boolean";
  return (
    <div
      data-field={field.path.join(".")}
      data-kind={field.kind}
      style={{
        display: "flex",
        flexDirection: inline ? "row-reverse" : "column",
        justifyContent: inline ? "flex-end" : undefined,
        alignItems: inline ? "center" : undefined,
        gap: 4,
      }}
    >
      <div style={{ ...rowStyle, alignItems: "center", flex: inline ? undefined : "none" }}>
        <label htmlFor={inputId} style={labelStyle}>
          {ctx.t.field(field.key)}
        </label>
        {field.optional && !absent && !disabled && !inline ? (
          <ctx.uiKit.Button
            type="button"
            style={{ ...smallButtonStyle, marginLeft: "auto", fontSize: 10 }}
            title={ctx.t.ui("unset")}
            onClick={() => onChange(undefined)}
          >
            {ctx.t.ui("unset")}
          </ctx.uiKit.Button>
        ) : null}
      </div>
      {body}
    </div>
  );
}

export type SchemaFormProps = {
  /** Raíz de `describeSchema` (un objeto). */
  root: FormField;
  value: Record<string, unknown>;
  /** Cambio de una propiedad de primer nivel (el valor completo de la propiedad). */
  onPropertyChange: (key: string, value: unknown) => void;
  ctx: SchemaFormContext;
};

/** Formulario generado: una fila por propiedad de primer nivel del esquema. */
export function SchemaForm({ root, value, onPropertyChange, ctx }: SchemaFormProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-schema-form="">
      {(root.fields ?? []).map((field) => (
        <FieldView
          key={field.key}
          field={field}
          value={value[field.key]}
          onChange={(next) => onPropertyChange(field.key, next)}
          ctx={ctx}
        />
      ))}
    </div>
  );
}
