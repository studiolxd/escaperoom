import { LocalizedTextSchema } from "@escaperoom/shared/schemas";
import { z } from "zod";
import type { RefKind, RefSpec } from "./references";

/**
 * Generador de formularios dirigido por el esquema (specs/09 §4.1: el
 * inspector es «genérico, dirigido por el tipo del elemento, no un componente
 * por tipo»). Recorre un esquema Zod de `@escaperoom/shared/schemas` y devuelve
 * un árbol de `FormField` que `<SchemaForm>` pinta. Un campo nuevo en el
 * contrato aparece solo en el inspector; un TIPO de campo nuevo se añade
 * registrando un `FieldKindDefinition` (y, si hace falta, su renderer), sin
 * tocar el generador.
 */

/** Tipos de campo que trae el generador. Los registrados por el host son strings libres. */
export type BuiltinFormFieldKind =
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "literal"
  | "object"
  | "list"
  | "record"
  | "union"
  | "localizedText"
  | "json";

export type FormFieldKind = BuiltinFormFieldKind | (string & {});

export type UnionVariant = {
  /** Valor del discriminador (`on_interact`) o tipo del campo (`text`, `object`). */
  value: string;
  field: FormField;
};

/**
 * Descripción de un campo. Las propiedades específicas de cada tipo son
 * opcionales para que un tipo registrado pueda añadir las suyas en `meta`.
 */
export interface FormField {
  kind: FormFieldKind;
  /** Nombre de la propiedad (`""` para la raíz, un elemento de lista o un valor de record). */
  key: string;
  /** Ruta del esquema: claves y `*` por elemento de lista/record (`inventory.*`). */
  path: readonly string[];
  optional: boolean;
  nullable: boolean;
  /** Esquema ya sin `optional`/`nullable`/`default`. */
  schema: z.ZodType;
  /** El valor es un id de este tipo: el formulario ofrece los existentes. */
  ref?: RefKind;
  readOnly?: boolean;
  /** Valores sugeridos para un texto libre (p. ej. tipos de objeto conocidos). */
  suggestions?: readonly string[];
  /** number */
  integer?: boolean;
  min?: number;
  /** enum */
  options?: readonly string[];
  /** literal */
  value?: unknown;
  /** object */
  fields?: FormField[];
  /** list */
  item?: FormField;
  /** record */
  valueField?: FormField;
  /** union */
  variants?: UnionVariant[];
  discriminator?: string;
  /** Datos libres de un tipo registrado. */
  meta?: Record<string, unknown>;
}

/** Ajustes por ruta (`hidingSpot.contains`, `inventory.*`) que el esquema no expresa. */
export type FieldHint = Partial<
  Pick<FormField, "ref" | "readOnly" | "suggestions" | "kind" | "meta">
> & { hidden?: boolean };

export type DescribeContext = {
  path: readonly string[];
  key: string;
  hint?: FieldHint;
};

export type DescribeFn = (
  schema: z.ZodType,
  key: string,
  path: readonly string[],
) => FormField | null;

/**
 * Un tipo de campo. `match` recibe el esquema ya sin envoltorios; `build`
 * añade las propiedades del tipo (hijos, opciones…) y puede describir hijos con
 * `describe`; `defaultValue` da el valor inicial al crear el campo.
 */
export type FieldKindDefinition = {
  kind: FormFieldKind;
  match: (schema: z.ZodType, ctx: DescribeContext) => boolean;
  build?: (schema: z.ZodType, ctx: DescribeContext, describe: DescribeFn) => Partial<FormField>;
  defaultValue?: (field: FormField, defaults: (field: FormField) => unknown) => unknown;
};

// ---------------------------------------------------------------------------
// Tipos incluidos
// ---------------------------------------------------------------------------

const join = (path: readonly string[], key: string) => (key ? [...path, key] : [...path]);

function optionFromDiscriminator(option: z.ZodType, discriminator: string): string | undefined {
  if (!(option instanceof z.ZodObject)) return undefined;
  const literal = (option.shape as Record<string, z.ZodType>)[discriminator];
  if (literal instanceof z.ZodLiteral) return String(literal.value);
  return undefined;
}

export const BUILTIN_FIELD_KINDS: readonly FieldKindDefinition[] = [
  {
    // Antes que `record`: un LocalizedText es un record, pero se edita por idioma.
    kind: "localizedText",
    match: (schema) => schema === LocalizedTextSchema,
    defaultValue: () => ({}),
  },
  { kind: "text", match: (s) => s instanceof z.ZodString, defaultValue: () => "" },
  {
    kind: "number",
    match: (s) => s instanceof z.ZodNumber,
    build: (s) => {
      const n = s as z.ZodNumber;
      const min = n.minValue;
      return {
        integer: typeof n.format === "string" && n.format.includes("int"),
        ...(min !== null && Number.isFinite(min) ? { min } : {}),
      };
    },
    defaultValue: (field) => {
      if (field.min === undefined) return 0;
      if (isExclusiveMin(field.schema))
        return field.integer ? Math.floor(field.min) + 1 : field.min + 1;
      return field.integer ? Math.ceil(field.min) : field.min;
    },
  },
  { kind: "boolean", match: (s) => s instanceof z.ZodBoolean, defaultValue: () => false },
  {
    kind: "enum",
    match: (s) => s instanceof z.ZodEnum,
    build: (s) => ({ options: (s as z.ZodEnum).options.map(String) }),
    defaultValue: (field) => field.options?.[0] ?? "",
  },
  {
    kind: "literal",
    match: (s) => s instanceof z.ZodLiteral,
    build: (s) => ({ value: (s as z.ZodLiteral).value, readOnly: true }),
    defaultValue: (field) => field.value,
  },
  {
    kind: "object",
    match: (s) => s instanceof z.ZodObject,
    build: (s, ctx, describe) => {
      const shape = (s as z.ZodObject).shape as Record<string, z.ZodType>;
      const fields = Object.entries(shape).flatMap(([key, child]) => {
        const field = describe(child, key, ctx.path);
        return field ? [field] : [];
      });
      return { fields };
    },
    defaultValue: (field, defaults) => {
      const out: Record<string, unknown> = {};
      for (const child of field.fields ?? []) {
        if (!child.optional) out[child.key] = defaults(child);
      }
      return out;
    },
  },
  {
    kind: "list",
    match: (s) => s instanceof z.ZodArray,
    build: (s, ctx, describe) => {
      const item = describe((s as z.ZodArray).element as z.ZodType, "", [...ctx.path, "*"]);
      return item ? { item } : { kind: "json" };
    },
    defaultValue: () => [],
  },
  {
    kind: "record",
    match: (s) => s instanceof z.ZodRecord,
    build: (s, ctx, describe) => {
      const valueField = describe((s as z.ZodRecord).valueType as z.ZodType, "", [
        ...ctx.path,
        "*",
      ]);
      return valueField ? { valueField } : { kind: "json" };
    },
    defaultValue: () => ({}),
  },
  {
    kind: "union",
    match: (s) => s instanceof z.ZodUnion,
    build: (s, ctx, describe) => {
      const union = s as z.ZodUnion;
      const discriminator = (union._zod.def as { discriminator?: string }).discriminator;
      const variants: UnionVariant[] = [];
      for (const option of union.options as readonly z.ZodType[]) {
        // Las variantes comparten la ruta de la unión: `trigger.objectId`.
        const field = describe(option, "", ctx.path);
        if (!field) continue;
        const value = discriminator ? optionFromDiscriminator(option, discriminator) : field.kind;
        if (value === undefined) return { kind: "json" };
        variants.push({ value, field });
      }
      return { variants, ...(discriminator ? { discriminator } : {}) };
    },
    defaultValue: (field, defaults) => {
      const first = field.variants?.[0];
      return first ? defaults(first.field) : null;
    },
  },
];

function isExclusiveMin(schema: z.ZodType): boolean {
  const checks = (schema._zod.def as { checks?: { _zod: { def: Record<string, unknown> } }[] })
    .checks;
  return (
    checks?.some(
      (check) => check._zod.def.check === "greater_than" && check._zod.def.inclusive === false,
    ) ?? false
  );
}

/** Último recurso: el valor se edita como JSON. */
const JSON_KIND: FieldKindDefinition = {
  kind: "json",
  match: () => true,
  defaultValue: () => null,
};

// ---------------------------------------------------------------------------
// Generador
// ---------------------------------------------------------------------------

export type DescribeOptions = {
  /** Tipos registrados por el host: se prueban ANTES que los incluidos. */
  kinds?: readonly FieldKindDefinition[];
  /** Ajustes por ruta (`a.b`, `lista.*`). */
  hints?: Readonly<Record<string, FieldHint>>;
  /** Propiedades de primer nivel que no se muestran (el `id` se renombra aparte). */
  omit?: readonly string[];
};

type Unwrapped = { schema: z.ZodType; optional: boolean; nullable: boolean };

/** Quita `optional`, `nullable`, `default`, `readonly`, `lazy` y `pipe` (entrada). */
export function unwrapSchema(schema: z.ZodType): Unwrapped {
  let current = schema;
  let optional = false;
  let nullable = false;
  for (let guard = 0; guard < 32; guard++) {
    if (current instanceof z.ZodOptional) {
      optional = true;
      current = current.unwrap() as z.ZodType;
    } else if (current instanceof z.ZodNullable) {
      nullable = true;
      current = current.unwrap() as z.ZodType;
    } else if (current instanceof z.ZodDefault) {
      optional = true;
      current = current.unwrap() as z.ZodType;
    } else if (current instanceof z.ZodReadonly) {
      current = current.unwrap() as z.ZodType;
    } else if (current instanceof z.ZodLazy) {
      current = current.unwrap() as z.ZodType;
    } else if (current instanceof z.ZodPipe) {
      current = current.in as z.ZodType;
    } else break;
  }
  return { schema: current, optional, nullable };
}

/** Pistas `ref` a partir de un mapa de referencias (`OBJECT_REFS`…). */
export function refHints(specs: readonly RefSpec[]): Record<string, FieldHint> {
  const hints: Record<string, FieldHint> = {};
  for (const spec of specs) {
    if (spec.path.includes("@key")) continue;
    hints[spec.path.join(".")] = { ref: spec.kind };
  }
  return hints;
}

/** Profundidad máxima (el esquema de acciones es recursivo por `delay`). */
const MAX_DEPTH = 8;

export function describeSchema(schema: z.ZodType, options: DescribeOptions = {}): FormField {
  const kinds = [...(options.kinds ?? []), ...BUILTIN_FIELD_KINDS, JSON_KIND];
  const omit = new Set(options.omit ?? []);

  const describe: DescribeFn = (raw, key, parentPath) => {
    const path = join(parentPath, key);
    if (path.length === 1 && omit.has(key)) return null;
    const hint = options.hints?.[path.join(".")];
    if (hint?.hidden) return null;
    const { schema: inner, optional, nullable } = unwrapSchema(raw);
    const ctx: DescribeContext = { path, key, hint };
    const base: FormField = { kind: "json", key, path, optional, nullable, schema: inner };
    if (path.filter((p) => p !== "*").length > MAX_DEPTH) return base;
    const forced = hint?.kind ? kinds.find((k) => k.kind === hint.kind) : undefined;
    const definition = forced ?? kinds.find((k) => k.match(inner, ctx)) ?? JSON_KIND;
    const built = definition.build?.(inner, ctx, describe) ?? {};
    const field: FormField = { ...base, kind: definition.kind, ...built };
    if (hint?.ref !== undefined) field.ref = hint.ref;
    if (hint?.readOnly !== undefined) field.readOnly = hint.readOnly;
    if (hint?.suggestions !== undefined) field.suggestions = hint.suggestions;
    if (hint?.meta !== undefined) field.meta = { ...field.meta, ...hint.meta };
    return field;
  };

  const root = describe(schema, "", []);
  if (!root) throw new Error("describeSchema: la raíz no puede omitirse");
  kindsByRoot.set(root, kinds);
  return root;
}

/** Tipos con los que se describió cada árbol (para calcular valores por defecto). */
const kindsByRoot = new WeakMap<FormField, readonly FieldKindDefinition[]>();

/** Valor inicial de un campo (al añadir un elemento a una lista, cambiar de variante…). */
export function defaultValueFor(
  field: FormField,
  kinds: readonly FieldKindDefinition[] = [],
): unknown {
  const all = [...kinds, ...BUILTIN_FIELD_KINDS, JSON_KIND];
  const defaults = (f: FormField): unknown => {
    const definition = all.find((k) => k.kind === f.kind);
    return definition?.defaultValue ? definition.defaultValue(f, defaults) : null;
  };
  return defaults(field);
}

/** Tipos registrados con los que se describió `root`, si se describió con `describeSchema`. */
export function kindsOf(root: FormField): readonly FieldKindDefinition[] {
  return kindsByRoot.get(root) ?? BUILTIN_FIELD_KINDS;
}

/** Variante de una unión que corresponde a `value` (la primera si ninguna encaja). */
export function matchVariant(field: FormField, value: unknown): UnionVariant | undefined {
  const variants = field.variants ?? [];
  if (field.discriminator) {
    const tag =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[field.discriminator]
        : undefined;
    return variants.find((v) => v.value === tag) ?? variants[0];
  }
  return variants.find((v) => v.field.schema.safeParse(value).success) ?? variants[0];
}

/** Busca un campo por su ruta de esquema (`hidingSpot.contains`). */
export function findField(root: FormField, path: string): FormField | undefined {
  if (root.path.join(".") === path) return root;
  const children = [
    ...(root.fields ?? []),
    ...(root.item ? [root.item] : []),
    ...(root.valueField ? [root.valueField] : []),
    ...(root.variants?.map((v) => v.field) ?? []),
  ];
  for (const child of children) {
    const found = findField(child, path);
    if (found) return found;
  }
  return undefined;
}
