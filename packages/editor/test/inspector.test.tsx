import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseRoomPackage,
  type CodeLockDefinition,
  type RoomPackage,
} from "@escaperoom/shared/schemas";
import { validateRoomPackage } from "@escaperoom/shared/validator";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { z } from "zod";
import {
  EditToolController,
  Inspector,
  InspectorError,
  PUZZLE_BASE_KEYS,
  SchemaForm,
  addRoomLanguage,
  createInspectorLabeler,
  defaultValueFor,
  describeSchema,
  describeTarget,
  findField,
  findRulesTouching,
  inspectElement,
  matchVariant,
  observeRoomDoc,
  renameElement,
  roomDocToPackage,
  roomPackageToDoc,
  setElementProperty,
  setLocalizedValue,
  type FieldKindDefinition,
  type FieldRenderer,
  type InspectorLabelsInput,
  type InspectorTarget,
  type LinkedTextSlotProps,
} from "../src";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture: RoomPackage = parseRoomPackage(
  JSON.parse(readFileSync(fixturePath, "utf8")) as unknown,
);

function aldricDoc(): Y.Doc {
  return roomPackageToDoc(fixture);
}

const errorsOf = (pkg: RoomPackage) =>
  validateRoomPackage(pkg).checks.filter((check) => check.status === "error");

const labels: InspectorLabelsInput = {
  kinds: { object: "Objeto", puzzle: "Puzzle", rule: "Regla" },
  fields: { sprite: "Sprite", states: "Estados", lockedBy: "Bloqueado por" },
  ui: { rulesTouching: "Reglas que lo tocan", openInGraph: "Ver en el grafo" },
};

function render(target: InspectorTarget | null, doc = aldricDoc(), extra: object = {}) {
  return renderToStaticMarkup(
    createElement(Inspector, {
      doc,
      target,
      labels,
      onSelect: () => {},
      onOpenRule: () => {},
      ...extra,
    }),
  );
}

describe("generador de formularios desde los esquemas Zod", () => {
  it("un WorldObject da un campo por propiedad, con referencias y opcionales", () => {
    const root = describeTarget("object");
    expect(root.kind).toBe("object");
    expect(root.fields?.map((f) => f.key)).toEqual([
      "roomId",
      "type",
      "position",
      "sprite",
      "states",
      "initialState",
      "inventory",
      "lockedBy",
      "interactable",
      "distribution",
      "hidingSpot",
      "leadsTo",
    ]);
    const field = (path: string) => findField(root, path);
    expect(field("roomId")).toMatchObject({ kind: "text", ref: "room", optional: false });
    expect(field("type")?.suggestions).toContain("puerta");
    expect(field("position")?.fields?.map((f) => [f.key, f.kind])).toEqual([
      ["x", "number"],
      ["y", "number"],
    ]);
    expect(field("states")?.kind).toBe("record");
    // SpriteState = string | { sprite?, animation? }: unión sin discriminador.
    expect(field("states.*")?.variants?.map((v) => v.value)).toEqual(["text", "object"]);
    expect(field("initialState")?.ref).toBe("state");
    expect(field("inventory")).toMatchObject({ kind: "list", optional: true });
    expect(field("inventory.*")?.ref).toBe("item");
    expect(field("lockedBy")).toMatchObject({ kind: "text", ref: "puzzle", optional: true });
    expect(field("leadsTo")).toMatchObject({ kind: "text", ref: "room", optional: true });
    expect(field("interactable")?.kind).toBe("boolean");
    expect(field("distribution")?.options).toEqual(["first_click", "all_players", "assigned"]);
    expect(field("hidingSpot.contains")?.ref).toBe("item");
  });

  it("un puzzle muestra solo los campos comunes; la plantilla queda para 3.5", () => {
    expect([...PUZZLE_BASE_KEYS].sort()).toEqual(
      [
        "grantsItems",
        "id",
        "layer",
        "position",
        "requiresSolved",
        "roomId",
        "timeLimitSec",
        "type",
        "unlocks",
      ].sort(),
    );
    const root = describeTarget("puzzle", "code_lock");
    const keys = root.fields?.map((f) => f.key) ?? [];
    expect(keys).toContain("unlocks");
    expect(keys).not.toContain("code");
    expect(keys).not.toContain("id");
    expect(findField(root, "type")).toMatchObject({
      kind: "literal",
      value: "code_lock",
      readOnly: true,
    });
    expect(findField(root, "unlocks.*")?.ref).toBe("object");
    expect(findField(root, "requiresSolved.*")?.ref).toBe("puzzle");
    expect(findField(root, "layer")?.options).toEqual(["world", "panel"]);
  });

  it("una regla: trigger como unión discriminada con los campos de cada variante", () => {
    const root = describeTarget("rule");
    expect(root.fields?.map((f) => f.key)).toEqual(["priority", "once", "trigger"]);
    const trigger = findField(root, "trigger");
    expect(trigger?.kind).toBe("union");
    expect(trigger?.discriminator).toBe("type");
    expect(trigger?.variants?.map((v) => v.value)).toContain("on_puzzle_solved");
    const variant = matchVariant(trigger!, { type: "on_use_item", objectId: "x", itemId: "y" });
    expect(variant?.field.fields?.map((f) => [f.key, f.ref])).toEqual([
      ["type", undefined],
      ["objectId", "object"],
      ["itemId", "item"],
    ]);
    // Cambiar de variante parte de un valor válido de la nueva.
    const onTimer = trigger!.variants!.find((v) => v.value === "on_time_remaining_below")!;
    expect(defaultValueFor(onTimer.field)).toEqual({ type: "on_time_remaining_below", seconds: 0 });
  });

  it("valores por defecto respetan el esquema (entero positivo, enum, objeto)", () => {
    const codeLock = describeSchema(
      z.object({
        length: z.number().int().positive(),
        mode: z.enum(["a", "b"]),
        tag: z.string().optional(),
      }),
    );
    expect(defaultValueFor(codeLock)).toEqual({ length: 1, mode: "a" });
  });

  it("un tipo de campo nuevo se registra sin tocar el generador (y se pinta con su renderer)", () => {
    const schema = z.object({
      label: z.string(),
      color: z.string().meta({ format: "color" }),
      when: z.date().optional(),
    });
    // Sin registrar: el color es un texto y la fecha cae a JSON.
    const plain = describeSchema(schema);
    expect(findField(plain, "color")?.kind).toBe("text");
    expect(findField(plain, "when")?.kind).toBe("json");

    const kinds: FieldKindDefinition[] = [
      {
        kind: "color",
        match: (s) => s instanceof z.ZodString && s.meta()?.format === "color",
        defaultValue: () => "#000000",
      },
      {
        kind: "date",
        match: (s) => s instanceof z.ZodDate,
        build: () => ({ meta: { granularity: "day" } }),
        defaultValue: () => "2026-01-01",
      },
    ];
    const root = describeSchema(schema, { kinds });
    expect(findField(root, "label")?.kind).toBe("text");
    expect(findField(root, "color")?.kind).toBe("color");
    expect(findField(root, "when")).toMatchObject({
      kind: "date",
      optional: true,
      meta: { granularity: "day" },
    });
    expect(defaultValueFor(root, kinds)).toEqual({ label: "", color: "#000000" });

    const ColorRenderer: FieldRenderer = ({ value }) =>
      createElement("input", { type: "color", "data-color": String(value), readOnly: true });
    const html = renderToStaticMarkup(
      createElement(SchemaForm, {
        root,
        value: { label: "Antorcha", color: "#ff8800" },
        onPropertyChange: () => {},
        ctx: {
          t: createInspectorLabeler(undefined),
          idOptions: () => [],
          kinds,
          renderers: { color: ColorRenderer },
          readOnly: false,
        },
      }),
    );
    expect(html).toContain('data-color="#ff8800"');
    expect(html).toContain('data-kind="color"');
    expect(html).toContain('value="Antorcha"');
  });
});

describe("inspector sobre el Rey Aldric", () => {
  it("seleccionar un objeto en el lienzo muestra sus propiedades, reglas y textos", () => {
    const doc = aldricDoc();
    const controller = new EditToolController(doc, { roomId: "salon-trono" });
    controller.pointer({ phase: "down", cell: { x: 6, y: 0 }, objectId: "cuadro-aurelio" });
    controller.pointer({ phase: "up", cell: { x: 6, y: 0 } });
    const selected = controller.getState().selectedObjectId;
    expect(selected).toBe("cuadro-aurelio");

    const target: InspectorTarget = { kind: "object", id: selected! };
    const html = render(target, doc);
    expect(html).toContain('data-inspector="object"');
    expect(html).toContain('value="cuadro-aurelio"');
    expect(html).toContain('value="cuadro-rey"'); // sprite
    expect(html).toContain('value="cuadro-rey-torcido"'); // estado open
    expect(html).toContain('data-field="hidingSpot.contains"');
    expect(html).toContain("Reglas que lo tocan");
    expect(html).toContain('data-rule="r-inspeccionar-cuadro"');
    expect(html).toContain('data-rule="r-revelar-cuadro"');
    expect(html).toContain('data-open-rule="r-revelar-cuadro"');
    expect(html).toContain('data-reference="p-llave-cuadro"');
    expect(html).toContain('data-linked-text="d-cuadro"');
    expect(html).toContain('data-linked-text="llave-bronce"');

    const inspected = inspectElement(roomDocToPackage(doc), target);
    expect(inspected?.rules.map((r) => r.ruleId)).toEqual([
      "r-inspeccionar-cuadro",
      "r-revelar-cuadro",
    ]);
    expect(inspected?.rules[0]).toMatchObject({ trigger: true, conditions: [], actions: [] });
    expect(inspected?.rules[1]).toMatchObject({ trigger: false, actions: [0] });
  });

  it("editar propiedades cambia el doc y roomDocToPackage lo refleja", () => {
    const doc = aldricDoc();
    const target: InspectorTarget = { kind: "object", id: "puerta-bodega" };
    setElementProperty(doc, target, "sprite", "puerta-hierro");
    setElementProperty(doc, target, "type", "puerta");
    setElementProperty(doc, target, "states", {
      closed: "puerta-cerrada",
      open: { sprite: "puerta-abierta", animation: "abrir" },
      rota: "puerta-rota",
    });
    setElementProperty(doc, target, "initialState", "rota");
    setElementProperty(doc, target, "interactable", false);
    setElementProperty(doc, target, "leadsTo", "catacumbas");
    setElementProperty(doc, target, "lockedBy", undefined);
    setElementProperty(doc, target, "position", { x: 9, y: 13 });
    setElementProperty(doc, { kind: "object", id: "armario" }, "inventory", ["vela"]);

    const pkg = roomDocToPackage(doc);
    const door = pkg.objects.find((o) => o.id === "puerta-bodega")!;
    expect(door).toMatchObject({
      sprite: "puerta-hierro",
      initialState: "rota",
      interactable: false,
      leadsTo: "catacumbas",
      position: { x: 9, y: 13 },
    });
    expect(door.states.open).toEqual({ sprite: "puerta-abierta", animation: "abrir" });
    expect("lockedBy" in door).toBe(false);
    expect(pkg.objects.find((o) => o.id === "armario")?.inventory).toEqual(["vela"]);
    expect(() => parseRoomPackage(pkg)).not.toThrow();
  });

  it("puzzles y reglas: campos comunes y trigger; lo no editable se rechaza", () => {
    const doc = aldricDoc();
    const puzzle: InspectorTarget = { kind: "puzzle", id: "p-candado-arca" };
    setElementProperty(doc, puzzle, "timeLimitSec", 120);
    setElementProperty(doc, puzzle, "requiresSolved", ["p-llave-cuadro"]);
    expect(() => setElementProperty(doc, puzzle, "type", "memory")).toThrow(InspectorError);

    const rule: InspectorTarget = { kind: "rule", id: "r-encender-brasero" };
    setElementProperty(doc, rule, "priority", 7);
    setElementProperty(doc, rule, "trigger", { type: "on_interact", objectId: "altar" });
    expect(() => setElementProperty(doc, rule, "actions", [])).toThrow(/no se edita/);

    const pkg = roomDocToPackage(doc);
    const lock = pkg.puzzles.find((p) => p.id === "p-candado-arca") as CodeLockDefinition;
    expect(lock).toMatchObject({
      timeLimitSec: 120,
      requiresSolved: ["p-llave-cuadro"],
      code: "4732",
    });
    expect(pkg.rules.find((r) => r.id === "r-encender-brasero")).toMatchObject({
      priority: 7,
      trigger: { type: "on_interact", objectId: "altar" },
    });
  });

  it("mover fuera de la habitación desde el inspector falla sin tocar el doc", () => {
    const doc = aldricDoc();
    const before = roomDocToPackage(doc);
    expect(() =>
      setElementProperty(doc, { kind: "object", id: "trono" }, "position", { x: 999, y: 0 }),
    ).toThrow(/fuera de la habitación/);
    expect(roomDocToPackage(doc)).toEqual(before);
  });

  it("el puzzle deja un slot para el configurador de su plantilla (3.5)", () => {
    const html = render({ kind: "puzzle", id: "p-candado-arca" }, aldricDoc(), {
      renderPuzzleConfigurator: ({ puzzle }: { puzzle: { type: string } }) =>
        createElement("div", { "data-configurator": puzzle.type }),
    });
    expect(html).toContain('data-configurator="code_lock"');
    expect(html).toContain('data-literal="code_lock"');
    expect(html).toContain('data-linked-text="hint-arca-1"');
    // El formulario genérico no pinta la configuración de la plantilla.
    expect(html).not.toContain('data-field="code"');
  });

  it("sin selección lista puzzles y reglas; un id inexistente avisa", () => {
    const html = render(null);
    expect(html).toContain('data-select-id="p-candado-arca"');
    expect(html).toContain('data-select-id="r-inicio"');
    expect(render({ kind: "object", id: "no-existe" })).toContain("missing");
  });
});

describe("renombrar ids reescribe todas las referencias en una transacción", () => {
  it("arca-candado → arca-tesoro: puzzle y reglas apuntan al nuevo id y el validador sigue en verde", () => {
    const doc = aldricDoc();
    expect(errorsOf(roomDocToPackage(doc))).toEqual([]);
    let notifications = 0;
    const stop = observeRoomDoc(doc, () => notifications++);

    const result = renameElement(doc, { kind: "object", id: "arca-candado" }, "arca-tesoro");
    stop();
    expect(notifications).toBe(1); // una sola transacción
    expect(result.rewritten.sort()).toEqual(
      ["puzzles.p-candado-arca.unlocks", "rules.r-abrir-arca.actions[0]"].sort(),
    );

    const pkg = roomDocToPackage(doc);
    expect(pkg.objects.map((o) => o.id)).not.toContain("arca-candado");
    // Conserva el orden y el resto de propiedades (sprite `arca` intacto).
    expect(pkg.objects.findIndex((o) => o.id === "arca-tesoro")).toBe(
      fixture.objects.findIndex((o) => o.id === "arca-candado"),
    );
    expect(pkg.objects.find((o) => o.id === "arca-tesoro")).toMatchObject({
      sprite: "arca",
      lockedBy: "p-candado-arca",
    });
    expect(pkg.puzzles.find((p) => p.id === "p-candado-arca")?.unlocks).toEqual(["arca-tesoro"]);
    expect(pkg.rules.find((r) => r.id === "r-abrir-arca")?.actions).toEqual([
      { type: "set_object_state", objectId: "arca-tesoro", state: "open" },
    ]);
    expect(JSON.stringify(pkg)).not.toContain('"arca-candado"');
    expect(errorsOf(pkg)).toEqual([]);
    expect(validateRoomPackage(pkg).ok).toBe(true);
  });

  it("renombrar un puzzle reescribe lockedBy, requiresSolved, pistas y triggers", () => {
    const doc = aldricDoc();
    renameElement(doc, { kind: "puzzle", id: "p-copas-memoria" }, "p-copas");
    renameElement(doc, { kind: "puzzle", id: "p-candado-arca" }, "p-candado");
    const pkg = roomDocToPackage(doc);
    expect(pkg.objects.find((o) => o.id === "mesa-catas")?.lockedBy).toBe("p-copas");
    expect(pkg.objects.find((o) => o.id === "arca-candado")?.lockedBy).toBe("p-candado");
    expect(pkg.puzzles.find((p) => p.id === "p-reja-mirillas")?.requiresSolved).toEqual([
      "p-copas",
    ]);
    expect(pkg.hints.filter((h) => h.puzzleId === "p-candado").map((h) => h.id)).toEqual([
      "hint-arca-1",
      "hint-arca-2",
    ]);
    expect(findRulesTouching(pkg.rules, "puzzle", "p-copas").map((t) => t.ruleId)).toEqual([
      "r-copas-resueltas",
    ]);
    expect(findRulesTouching(pkg.rules, "puzzle", "p-placas-estatuas")[0]?.ruleId).toBe(
      "r-placas-resueltas",
    );
    expect(errorsOf(pkg)).toEqual([]);
  });

  it("solo toca referencias semánticas: el sprite `trono` no cambia, las claves de visibleByViewpoint sí", () => {
    const doc = aldricDoc();
    renameElement(doc, { kind: "object", id: "trono" }, "trono-real");
    renameElement(doc, { kind: "object", id: "mirilla-a" }, "mirilla-oeste");
    const pkg = roomDocToPackage(doc);
    expect(pkg.objects.find((o) => o.id === "trono-real")?.sprite).toBe("trono");
    const split = pkg.puzzles.find((p) => p.id === "p-reja-mirillas");
    expect(split).toMatchObject({
      viewpoints: [{ objectId: "mirilla-oeste" }, { objectId: "mirilla-b" }],
    });
    expect(Object.keys((split as { visibleByViewpoint: object }).visibleByViewpoint)).toEqual([
      "mirilla-oeste",
      "mirilla-b",
    ]);
    expect(errorsOf(pkg)).toEqual([]);
  });

  it("renombrar una regla conserva su orden; ids inválidos o repetidos no tocan el doc", () => {
    const doc = aldricDoc();
    renameElement(doc, { kind: "rule", id: "r-inicio" }, "r-arranque");
    expect(roomDocToPackage(doc).rules[0]?.id).toBe("r-arranque");

    const before = roomDocToPackage(doc);
    expect(() => renameElement(doc, { kind: "object", id: "trono" }, "brasero")).toThrow(
      expect.objectContaining({ code: "DUPLICATE_ID" }),
    );
    expect(() => renameElement(doc, { kind: "object", id: "trono" }, "Trono Real")).toThrow(
      expect.objectContaining({ code: "INVALID_ID" }),
    );
    expect(() => renameElement(doc, { kind: "puzzle", id: "no-existe" }, "p-x")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_TARGET" }),
    );
    expect(roomDocToPackage(doc)).toEqual(before);
  });

  it("un colaborador recibe el renombrado completo por updates binarios", () => {
    const a = aldricDoc();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    renameElement(a, { kind: "object", id: "arca-candado" }, "arca-tesoro");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    expect(roomDocToPackage(b)).toEqual(roomDocToPackage(a));
  });
});

describe("textos localizados ligados al elemento", () => {
  it("editar el texto de un idioma desde el inspector escribe solo ese idioma", () => {
    const doc = aldricDoc();
    addRoomLanguage(doc, "en");
    const slots: LinkedTextSlotProps[] = [];
    const html = render({ kind: "object", id: "cuadro-aurelio" }, doc, {
      renderLocalizedText: (slot: LinkedTextSlotProps) => {
        slots.push(slot);
        return createElement("div", { "data-slot": slot.id, "data-audio": String(slot.audio) });
      },
    });
    expect(html).toContain('data-slot="d-cuadro"');
    const dialog = slots.find((s) => s.id === "d-cuadro")!;
    expect(dialog).toMatchObject({
      collection: "dialogs",
      languages: ["es", "en"],
      defaultLanguage: "es",
      audio: true,
    });
    expect(slots.find((s) => s.id === "llave-bronce")?.audio).toBe(false);

    setLocalizedValue(dialog.text, "en", "An old portrait of the king.");
    const pkg = roomDocToPackage(doc);
    const text = pkg.dialogs.find((d) => d.id === "d-cuadro")!.text;
    expect(text.en?.text).toBe("An old portrait of the king.");
    expect(text.es?.text).toBe(fixture.dialogs.find((d) => d.id === "d-cuadro")!.text.es!.text);
  });

  it("sin slot del host pinta un campo por idioma declarado", () => {
    const doc = aldricDoc();
    addRoomLanguage(doc, "fr");
    const html = render({ kind: "puzzle", id: "p-candado-arca" }, doc);
    expect(html).toContain("data-localized-fallback");
    expect(html).toContain('aria-label="hints · hint-arca-1 (fr)"');
    expect(html).toContain('aria-label="hints · hint-arca-1 (es)"');
  });
});
