import {
  PuzzleDefinitionSchema,
  type PuzzleDefinition,
  type PuzzleType,
} from "@escaperoom/shared/schemas";
import { isTemplateSolvable } from "@escaperoom/shared/validator";
import type * as Y from "yjs";
import { z } from "zod";
import { PUZZLE_BASE_KEYS, setElementProperty } from "../inspector/inspector-model";
import { PUZZLE_TYPE_REFS } from "../inspector/references";
import {
  describeSchema,
  refHints,
  type FieldKindDefinition,
  type FormField,
} from "../inspector/schema-form";
import { InspectorError } from "../inspector/target";

/**
 * Modelo headless del configurador de plantillas (ticket 3.5, specs/06): qué
 * campos son la configuración propia de cada plantilla, cómo se describen como
 * formulario (del esquema Zod, igual que el inspector de 3.4), cómo se escriben
 * en el doc Yjs y si la configuración resultante es resoluble (oráculo de la
 * plantilla, el mismo que usa el validador).
 */

type PuzzleOption = z.ZodObject;

const PUZZLE_OPTIONS = PuzzleDefinitionSchema.options as unknown as readonly PuzzleOption[];

function templateVariant(type: PuzzleType): PuzzleOption {
  const variant = PUZZLE_OPTIONS.find((option) => {
    const literal = (option.shape as Record<string, z.ZodType>).type;
    return literal instanceof z.ZodLiteral && literal.value === type;
  });
  if (!variant) throw new InspectorError("UNKNOWN_TARGET", `Plantilla desconocida "${type}"`);
  return variant;
}

/**
 * Claves de configuración de una plantilla, derivadas del esquema: las de su
 * variante que no son comunes a todas (`PUZZLE_BASE_KEYS`) ni el `type`.
 */
export function templateConfigKeys(type: PuzzleType): readonly string[] {
  return Object.keys(templateVariant(type).shape).filter(
    (key) => key !== "type" && !PUZZLE_BASE_KEYS.includes(key),
  );
}

export type TemplateConfigFormOptions = {
  /** Tipos de campo registrados por el host (ver `FieldKindDefinition`). */
  kinds?: readonly FieldKindDefinition[];
};

/**
 * Formulario de la configuración de una plantilla, generado de su esquema Zod
 * (mismo generador que el inspector). Los campos que apuntan a otros elementos
 * (placas, ítems-puente, compuertas…) llevan su `ref` de `PUZZLE_TYPE_REFS`.
 */
export function describeTemplateConfig(
  type: PuzzleType,
  options: TemplateConfigFormOptions = {},
): FormField {
  const keys = Object.fromEntries(templateConfigKeys(type).map((key) => [key, true as const]));
  return describeSchema(templateVariant(type).pick(keys as never), {
    kinds: options.kinds,
    hints: refHints(PUZZLE_TYPE_REFS[type]),
  });
}

/**
 * Escribe un campo de configuración de la plantilla en el doc Yjs (misma forma
 * de 3.1 que el inspector: una clave por propiedad del puzzle). Rechaza las
 * claves comunes (las edita el inspector) y las que no son de la plantilla.
 */
export function setTemplateConfig(
  doc: Y.Doc,
  puzzle: Pick<PuzzleDefinition, "id" | "type">,
  key: string,
  value: unknown,
): void {
  if (!templateConfigKeys(puzzle.type).includes(key)) {
    throw new InspectorError(
      "READ_ONLY_FIELD",
      `"${key}" no es un campo de configuración de ${puzzle.type}`,
    );
  }
  setElementProperty(doc, { kind: "puzzle", id: puzzle.id }, key, value);
}

/** Motivo por el que una configuración no se puede jugar. */
export type TemplateConfigIssue =
  /** No cumple el esquema de la plantilla (tipo o campo obligatorio). */
  | "schema"
  /** El oráculo de la plantilla dice que no es resoluble. */
  | "unsolvable";

export type TemplateConfigCheck =
  | { ok: true }
  | {
      ok: false;
      issue: TemplateConfigIssue;
      type: PuzzleType;
      /** Rutas del esquema que fallan (solo `schema`). */
      paths: string[];
    };

/**
 * Comprobación inmediata de la configuración (specs/22 §2.3): esquema y
 * oráculo de la plantilla sobre su estado inicial. Solo mira la plantilla: el
 * resto de la sala (habitación accesible, `requiresSolved`, puentes en solitario)
 * lo juzga el validador completo (3.7). En `pipes` las compuertas cuentan como
 * abribles (su objeto existe en algún momento de la partida).
 */
export function checkTemplateConfig(puzzle: PuzzleDefinition): TemplateConfigCheck {
  const parsed = PuzzleDefinitionSchema.safeParse(puzzle);
  if (!parsed.success) {
    return {
      ok: false,
      issue: "schema",
      type: puzzle.type,
      paths: [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    };
  }
  const def = parsed.data;
  const gateItems =
    def.type === "pipes"
      ? (def.blockedCells ?? []).flatMap((cell) =>
          cell.opensWithItem !== undefined ? [cell.opensWithItem] : [],
        )
      : [];
  if (!isTemplateSolvable({ ...def, requiresSolved: [] }, gateItems)) {
    return { ok: false, issue: "unsolvable", type: def.type, paths: [] };
  }
  return { ok: true };
}
