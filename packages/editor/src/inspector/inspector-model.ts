import {
  PuzzleDefinitionSchema,
  RuleSchema,
  WorldObjectSchema,
  type PuzzleDefinition,
  type RoomPackage,
  type Rule,
  type WorldObject,
} from "@escaperoom/shared/schemas";
import type * as Y from "yjs";
import { z } from "zod";
import { moveObject, readObject } from "../room-doc/commands";
import { collection, plain } from "../room-doc/doc-model";
import { getRulesMap, updateRule } from "../rules-graph/yjs-rules";
import {
  OBJECT_REFS,
  PUZZLE_BASE_REFS,
  RULE_FIELD_REFS,
  dialogsShownBy,
  findRulesTouching,
  puzzleRefs,
  referencesId,
  type RefKind,
  type RuleTouch,
} from "./references";
import {
  describeSchema,
  refHints,
  type FieldHint,
  type FieldKindDefinition,
  type FormField,
} from "./schema-form";
import { InspectorError, type InspectorTarget } from "./target";

/**
 * Modelo headless del inspector (specs/09 §4.1): qué esquema describe cada
 * elemento, cómo se lee del RoomPackage y cómo se escribe en el doc Yjs. El
 * componente React (`inspector.tsx`) solo combina esto con `<SchemaForm>`.
 */

/** Tipos de objeto de specs/04 §3.1 (el campo es libre: son sugerencias). */
export const OBJECT_TYPE_SUGGESTIONS = [
  "puerta",
  "cajon",
  "estatua",
  "placa",
  "escondite",
  "mecanismo",
  "decorativo",
] as const;

type PuzzleOption = z.ZodObject;

const PUZZLE_OPTIONS = PuzzleDefinitionSchema.options as unknown as readonly PuzzleOption[];

/**
 * Campos comunes a toda plantilla (specs/06 §1), derivados del esquema: los
 * que comparten las 8 variantes de `PuzzleDefinitionSchema`. El resto es la
 * configuración de la plantilla (3.5), que el inspector deja a su slot.
 */
export const PUZZLE_BASE_KEYS: readonly string[] = (() => {
  const [first, ...rest] = PUZZLE_OPTIONS.map((option) => Object.keys(option.shape));
  return (first ?? []).filter((key) => rest.every((keys) => keys.includes(key)));
})();

function puzzleVariant(type: string | undefined): PuzzleOption {
  return (
    PUZZLE_OPTIONS.find((option) => {
      const literal = (option.shape as Record<string, z.ZodType>).type;
      return literal instanceof z.ZodLiteral && literal.value === type;
    }) ?? (PUZZLE_OPTIONS[0] as PuzzleOption)
  );
}

/** Pistas `ref` de un trigger (mismo vocabulario de campos que el grafo). */
const TRIGGER_HINTS: Record<string, FieldHint> = Object.fromEntries(
  Object.entries(RULE_FIELD_REFS).map(([key, kind]) => [`trigger.${key}`, { ref: kind }]),
);

export type TargetFormOptions = {
  /** Tipos de campo registrados por el host (ver `FieldKindDefinition`). */
  kinds?: readonly FieldKindDefinition[];
};

/**
 * Formulario de un elemento, generado de su esquema Zod. `puzzleType` elige la
 * variante (solo sus campos comunes: la plantilla la configura 3.5).
 */
export function describeTarget(
  kind: InspectorTarget["kind"],
  puzzleType?: string,
  options: TargetFormOptions = {},
): FormField {
  const kinds = options.kinds;
  switch (kind) {
    case "object":
      return describeSchema(WorldObjectSchema, {
        kinds,
        omit: ["id"],
        hints: { ...refHints(OBJECT_REFS), type: { suggestions: OBJECT_TYPE_SUGGESTIONS } },
      });
    case "puzzle": {
      const keys = Object.fromEntries(
        [...PUZZLE_BASE_KEYS, "type"].map((key) => [key, true as const]),
      );
      return describeSchema(puzzleVariant(puzzleType).pick(keys as never), {
        kinds,
        omit: ["id"],
        hints: refHints(PUZZLE_BASE_REFS),
      });
    }
    case "rule":
      return describeSchema(RuleSchema, {
        kinds,
        // Condiciones y acciones se editan en el grafo de reglas (3.6).
        omit: ["id", "conditions", "actions"],
        hints: TRIGGER_HINTS,
      });
  }
}

// ---------------------------------------------------------------------------
// Lectura (desde el RoomPackage de `roomDocToPackage`)
// ---------------------------------------------------------------------------

export type ElementValue = WorldObject | PuzzleDefinition | Rule;

export function findElement(pkg: RoomPackage, target: InspectorTarget): ElementValue | undefined {
  switch (target.kind) {
    case "object":
      return pkg.objects.find((o) => o.id === target.id);
    case "puzzle":
      return pkg.puzzles.find((p) => p.id === target.id);
    case "rule":
      return pkg.rules.find((r) => r.id === target.id);
  }
}

/** Otro elemento que referencia al inspeccionado (el puzzle que abre un arca…). */
export type ElementReference = { kind: "object" | "puzzle"; id: string };

/** Texto localizado ligado al elemento, editable desde el inspector. */
export type LinkedText = {
  collection: "dialogs" | "hints" | "items";
  id: string;
};

export type InspectedElement = {
  target: InspectorTarget;
  value: ElementValue;
  /** «Reglas que lo tocan» (specs/09 §3). */
  rules: RuleTouch[];
  referencedBy: ElementReference[];
  texts: LinkedText[];
};

function objectsReferencing(pkg: RoomPackage, kind: RefKind, id: string): ElementReference[] {
  return pkg.objects
    .filter((o) => o.id !== id || kind !== "object")
    .filter((o) => referencesId(o, OBJECT_REFS, kind, id))
    .map((o) => ({ kind: "object" as const, id: o.id }));
}

function puzzlesReferencing(pkg: RoomPackage, kind: RefKind, id: string): ElementReference[] {
  return pkg.puzzles
    .filter((p) => !(kind === "puzzle" && p.id === id))
    .filter((p) => referencesId(p, puzzleRefs(p.type), kind, id))
    .map((p) => ({ kind: "puzzle" as const, id: p.id }));
}

function unique(texts: LinkedText[], pkg: RoomPackage): LinkedText[] {
  const exists = (t: LinkedText) => pkg[t.collection].some((entry) => entry.id === t.id);
  const seen = new Set<string>();
  return texts.filter((t) => {
    const key = `${t.collection}:${t.id}`;
    if (seen.has(key) || !exists(t)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Todo lo que muestra el inspector de un elemento, calculado del RoomPackage
 * (puro). `null` si el elemento ya no existe (lo borró otro colaborador).
 */
export function inspectElement(pkg: RoomPackage, target: InspectorTarget): InspectedElement | null {
  const value = findElement(pkg, target);
  if (!value) return null;
  const { kind, id } = target;
  if (kind === "rule") {
    const rule = value as Rule;
    return {
      target,
      value,
      rules: [],
      referencedBy: [],
      texts: unique(
        dialogsShownBy(rule.actions).map((d) => ({ collection: "dialogs", id: d })),
        pkg,
      ),
    };
  }
  const rules = findRulesTouching(pkg.rules, kind, id);
  const referencedBy = [...objectsReferencing(pkg, kind, id), ...puzzlesReferencing(pkg, kind, id)];
  const texts: LinkedText[] = [];
  if (kind === "object") {
    const object = value as WorldObject;
    // Diálogos que se muestran al interactuar con él (o usar un ítem sobre él).
    for (const touch of rules) {
      const rule = pkg.rules.find((r) => r.id === touch.ruleId);
      if (rule && touch.trigger) {
        for (const d of dialogsShownBy(rule.actions)) texts.push({ collection: "dialogs", id: d });
      }
    }
    if (object.hidingSpot) texts.push({ collection: "items", id: object.hidingSpot.contains });
    for (const item of object.inventory ?? []) texts.push({ collection: "items", id: item });
  } else {
    const puzzle = value as PuzzleDefinition;
    const hints = pkg.hints.filter((h) => h.puzzleId === id).sort((a, b) => a.tier - b.tier);
    for (const hint of hints) texts.push({ collection: "hints", id: hint.id });
    for (const item of puzzle.grantsItems) texts.push({ collection: "items", id: item });
  }
  return { target, value, rules, referencedBy, texts: unique(texts, pkg) };
}

/** Ids existentes de un tipo, para los campos con `ref`. `state` sale del propio objeto. */
export function idOptions(pkg: RoomPackage, ref: RefKind, element?: ElementValue): string[] {
  switch (ref) {
    case "object":
      return pkg.objects.map((o) => o.id);
    case "puzzle":
      return pkg.puzzles.map((p) => p.id);
    case "item":
      return pkg.items.map((i) => i.id);
    case "room":
      return pkg.map.rooms.map((r) => r.id);
    case "hint":
      return pkg.hints.map((h) => h.id);
    case "dialog":
      return pkg.dialogs.map((d) => d.id);
    case "state": {
      const states = (element as Partial<WorldObject> | undefined)?.states;
      return states ? Object.keys(states) : [];
    }
  }
}

// ---------------------------------------------------------------------------
// Escritura (en el doc Yjs)
// ---------------------------------------------------------------------------

const READ_ONLY: Record<InspectorTarget["kind"], readonly string[]> = {
  object: ["id"],
  // Cambiar de plantilla no es editar una propiedad: es otro puzzle (3.5).
  puzzle: ["id", "type"],
  rule: ["id", "conditions", "actions"],
};

/**
 * Escribe una propiedad de primer nivel del elemento (el formulario compone
 * los valores anidados y entrega el valor completo de la propiedad).
 * `undefined` quita una propiedad opcional. Posición y habitación de un objeto
 * pasan por `moveObject` (3.1), que comprueba que la celda existe.
 */
export function setElementProperty(
  doc: Y.Doc,
  target: InspectorTarget,
  key: string,
  value: unknown,
): void {
  if (READ_ONLY[target.kind].includes(key)) {
    throw new InspectorError("READ_ONLY_FIELD", `"${key}" no se edita desde el formulario`);
  }
  if (target.kind === "rule") {
    if (!getRulesMap(doc).has(target.id)) {
      throw new InspectorError("UNKNOWN_TARGET", `No existe la regla "${target.id}"`);
    }
    if (key === "priority" || key === "once" || key === "trigger") {
      updateRule(doc, target.id, { [key]: value } as Parameters<typeof updateRule>[2]);
      return;
    }
    throw new InspectorError("READ_ONLY_FIELD", `"${key}" no es una propiedad de la regla`);
  }

  const record = collection(doc, target.kind === "object" ? "objects" : "puzzles").get(target.id);
  if (!record) throw new InspectorError("UNKNOWN_TARGET", `No existe "${target.id}"`);

  if (target.kind === "object" && (key === "position" || key === "roomId")) {
    const object = readObject(doc, target.id) as WorldObject;
    const position = key === "position" ? (value as WorldObject["position"]) : object.position;
    const roomId = key === "roomId" ? String(value) : object.roomId;
    moveObject(doc, target.id, { x: Number(position.x), y: Number(position.y) }, roomId);
    return;
  }
  doc.transact(() => {
    if (value === undefined) record.delete(key);
    else record.set(key, plain(value));
  });
}

/** ¿Existe aún el elemento en el doc? */
export function elementExists(doc: Y.Doc, target: InspectorTarget): boolean {
  if (target.kind === "rule") return getRulesMap(doc).has(target.id);
  return collection(doc, target.kind === "object" ? "objects" : "puzzles").has(target.id);
}
