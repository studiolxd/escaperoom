import {
  EditToolController,
  addRoomLanguage,
  renameElement,
  roomDocToPackage,
  roomPackageToDoc,
  type InspectorTarget,
} from "@escaperoom/editor";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import de from "../messages/de.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import nl from "../messages/nl.json";
import pt from "../messages/pt.json";
import { RoomEditorInspector } from "../src/components/room-editor/room-editor-inspector";
import { RoomEditorWorkspace } from "../src/components/room-editor/room-editor-workspace";
import { resolveEditorPalette } from "../src/lib/editor-palette";
import { readReyAldricRoomPackageJson } from "../src/lib/room-preview-fixture";

const fixture = loadRoomPackage(readReyAldricRoomPackageJson());

function render(element: ReactElement, messages: AbstractIntlMessages = es, locale = "es"): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages, children: element }),
  );
}

function inspector(target: InspectorTarget | null, doc = roomPackageToDoc(fixture)) {
  return createElement(RoomEditorInspector, {
    doc,
    target,
    onSelect: () => {},
    onOpenRule: () => {},
    onDelete: () => {},
  });
}

describe("<RoomEditorInspector> — inspector (3.4) en el editor", () => {
  it("un objeto del Rey Aldric muestra sus propiedades con los textos del catálogo", () => {
    const html = render(inspector({ kind: "object", id: "arca-candado" }));
    expect(html).toContain('data-testid="room-editor-inspector"');
    expect(html).toContain('data-inspector="object"');
    expect(html).toContain("Bloqueado por (puzzle)");
    expect(html).toContain("Estado inicial");
    expect(html).toContain('value="arca-candado"');
    expect(html).toContain("Reglas que lo tocan");
    expect(html).toContain('data-rule="r-abrir-arca"');
    expect(html).toContain("acciones: 1");
    expect(html).toContain("Ver en el grafo");
    expect(html).toContain("Puzzle: p-candado-arca");
    expect(html).toContain("Borrar");
  });

  it("los textos ligados usan los campos de idioma (3.10) y de audio (3.11)", () => {
    const doc = roomPackageToDoc(fixture);
    addRoomLanguage(doc, "en");
    const html = render(inspector({ kind: "object", id: "cuadro-aurelio" }, doc));
    expect(html).toContain('data-linked-text="d-cuadro"');
    expect(html).toContain('data-testid="localized-text-field"');
    expect(html).toContain('data-testid="localized-audio-field"');
    expect(html).toContain("Diálogo · d-cuadro");
    expect(html).toMatch(/data-language="en"[^>]*data-missing="true"/);
    // El ítem escondido (llave-bronce) tiene nombre localizado pero no audio.
    expect(html).toContain("Ítem · llave-bronce");
  });

  it("puzzles y reglas: campos comunes, slot de plantilla y trigger con sus tipos traducidos", () => {
    const puzzle = render(inspector({ kind: "puzzle", id: "p-candado-arca" }));
    expect(puzzle).toContain("Candado de código");
    expect(puzzle).toContain("Configuración de la plantilla");
    expect(puzzle).toContain("Desbloquea");
    const rule = render(inspector({ kind: "rule", id: "r-abrir-arca" }));
    expect(rule).toContain("Al resolver un puzzle");
    expect(rule).toContain("Las condiciones y acciones se editan en el grafo de reglas.");
    const none = render(inspector(null));
    expect(none).toContain('data-select-id="r-abrir-arca"');
  });

  it("tras renombrar desde el inspector el validador sigue en verde", () => {
    const doc = roomPackageToDoc(fixture);
    const result = renameElement(doc, { kind: "object", id: "arca-candado" }, "arca-tesoro");
    expect(result.rewritten).toHaveLength(2);
    const html = render(inspector({ kind: "object", id: "arca-tesoro" }, doc));
    expect(html).toContain('data-rule="r-abrir-arca"');
    expect(roomDocToPackage(doc).puzzles.find((p) => p.id === "p-candado-arca")?.unlocks).toEqual([
      "arca-tesoro",
    ]);
  });

  it("todos los catálogos traducen el inspector", () => {
    const catalogs = { en, fr, de, nl, pt };
    for (const [locale, messages] of Object.entries(catalogs)) {
      const html = render(inspector({ kind: "object", id: "arca-candado" }), messages, locale);
      expect(html, locale).toContain(messages.Inspector.labels.ui.rulesTouching);
      expect(html, locale).toContain(messages.Inspector.labels.fields.lockedBy);
      expect(html, locale).not.toContain(">rulesTouching<");
    }
  });
});

describe("<RoomEditorWorkspace> con inspector y grafo de reglas", () => {
  it("el inspector sustituye al panel de selección y hay pestañas mapa/reglas", () => {
    const doc = roomPackageToDoc(fixture);
    const controller = new EditToolController(doc, { roomId: "salon-trono" });
    controller.select("brasero");
    const base = {
      doc,
      controller,
      palette: resolveEditorPalette("medieval-v1").palette,
      status: "local" as const,
      inspector: inspector({ kind: "object", id: "brasero" }, doc),
      rulesGraph: createElement("div", { "data-graph": "" }),
    };
    const onMap = render(createElement(RoomEditorWorkspace, base));
    expect(onMap).toContain('data-inspector="object"');
    expect(onMap).not.toContain("data-selected-object");
    expect(onMap).toContain('data-canvas-tab="map"');
    expect(onMap).toContain('data-canvas-tab="rules"');
    expect(onMap).not.toContain("data-rules-tab");

    const onRules = render(createElement(RoomEditorWorkspace, { ...base, canvasTab: "rules" }));
    expect(onRules).toContain("data-rules-tab");
    expect(onRules).toContain("data-graph");
  });
});
