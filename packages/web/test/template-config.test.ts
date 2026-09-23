import { roomDocToPackage, roomPackageToDoc, type InspectorTarget } from "@escaperoom/editor";
import { createTemplatePreview, setTemplateConfig } from "@escaperoom/editor/template-config";
import { loadRoomPackage, resolveIconFrame } from "@escaperoom/game-runtime";
import { PUZZLE_TYPES_MVP, type PuzzleDefinition } from "@escaperoom/shared/schemas";
import { createRoomSession } from "@escaperoom/shared/session";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type * as Y from "yjs";
import de from "../messages/de.json";
import en from "../messages/en.json";
import es from "../messages/es.json";
import fr from "../messages/fr.json";
import nl from "../messages/nl.json";
import pt from "../messages/pt.json";
import { CodeLockPanel } from "../src/components/puzzles/code-lock-panel";
import { ItemIcon } from "../src/components/puzzles/item-icon";
import { RoomEditorInspector } from "../src/components/room-editor/room-editor-inspector";
import { previewItems } from "../src/components/template-config/puzzle-configurator";
import { TemplatePreviewPanel } from "../src/components/template-config/template-preview";
import { readReyAldricRoomPackageJson } from "../src/lib/room-preview-fixture";

const fixture = loadRoomPackage(readReyAldricRoomPackageJson());

function render(element: ReactElement, messages: AbstractIntlMessages = es, locale = "es"): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages, children: element }),
  );
}

function inspector(target: InspectorTarget, doc: Y.Doc) {
  return createElement(RoomEditorInspector, {
    doc,
    target,
    onSelect: () => {},
    onOpenRule: () => {},
  });
}

function puzzleIn(doc: Y.Doc, id: string): PuzzleDefinition {
  const puzzle = roomDocToPackage(doc).puzzles.find((p) => p.id === id);
  if (!puzzle) throw new Error(`no existe ${id}`);
  return puzzle;
}

const noop = () => {};

describe("configuradores de plantillas (3.5) en el editor", () => {
  it("configurar un candado y ver su vista previa produce el mismo markup que en juego", () => {
    const doc = roomPackageToDoc(fixture);
    const lock = puzzleIn(doc, "p-candado-arca");
    setTemplateConfig(doc, lock, "length", 6);
    setTemplateConfig(doc, lock, "code", "902137");
    setTemplateConfig(doc, lock, "maxAttempts", 3);
    const configured = puzzleIn(doc, "p-candado-arca");

    // En juego: la sesión autoritativa sobre el RoomPackage del editor.
    const session = createRoomSession(roomDocToPackage(doc), { playerIds: ["p1"] });
    const game = render(
      createElement(CodeLockPanel, {
        view: session.codeLockView("p-candado-arca"),
        onAttempt: noop,
        feedback: null,
      }),
    );
    // En el editor: la vista previa del configurador con esa misma config.
    const preview = render(
      createElement(TemplatePreviewPanel, {
        preview: createTemplatePreview(configured),
        onAction: noop,
        now: 0,
      }),
    );
    expect(preview).toBe(game);
    expect(game).toContain("Intentos: 0/3");
    expect(game.match(/data-filled="false"/g)).toHaveLength(6);

    // Y el inspector monta exactamente ese panel dentro del configurador.
    const html = render(inspector({ kind: "puzzle", id: "p-candado-arca" }, doc));
    expect(html).toContain('data-testid="puzzle-configurator"');
    expect(html).toContain('data-template-preview="code_lock"');
    expect(html).toContain(game);
    // El código nunca llega al panel (proyección pública), sí al formulario.
    expect(game).not.toContain("902137");
    expect(html).toContain('value="902137"');
  });

  it.each(PUZZLE_TYPES_MVP)(
    "%s: formulario de la plantilla, aviso del oráculo y vista previa con el panel de juego",
    (type) => {
      const doc = roomPackageToDoc(fixture);
      const puzzle = fixture.puzzles.find((p) => p.type === type)!;
      const html = render(inspector({ kind: "puzzle", id: puzzle.id }, doc));
      expect(html).toContain(`data-template="${type}"`);
      expect(html).toContain('data-template-issue="none"');
      expect(html).toContain("Configuración resoluble.");
      expect(html).toContain(`data-template-preview="${type}"`);
      expect(html).toContain("Vista previa jugable (como en juego)");
      expect(html).not.toContain("llega con los configuradores");
      const panel = render(
        createElement(TemplatePreviewPanel, {
          preview: createTemplatePreview(puzzle),
          onAction: noop,
          now: 0,
          // Mismo catálogo e iconos que monta el configurador (como el inventario en juego).
          items: previewItems(fixture, "es"),
          renderIcon: (item) =>
            createElement(ItemIcon, {
              frame: resolveIconFrame(undefined, item.icon ?? ""),
              name: item.name,
            }),
        }),
      );
      expect(panel.length).toBeGreaterThan(0);
      expect(html).toContain(panel);
    },
  );

  it("los campos de la plantilla salen del esquema con sus nombres traducidos", () => {
    const doc = roomPackageToDoc(fixture);
    const plates = render(inspector({ kind: "puzzle", id: "p-placas-estatuas" }, doc));
    expect(plates).toContain("Ventana simultánea (ms)");
    expect(plates).toContain("Quedarse encima");
    expect(plates).toContain("Objeto-puente (solitario)");
    const pipes = render(inspector({ kind: "puzzle", id: "p-canal-agua" }, doc), en, "en");
    expect(pipes).toContain("Blocked cells");
    expect(pipes).toContain("Opens with");
  });

  it("una tubería sin camino muestra el aviso del oráculo al instante", () => {
    const doc = roomPackageToDoc(fixture);
    const pipes = puzzleIn(doc, "p-canal-agua");
    setTemplateConfig(
      doc,
      pipes,
      "blockedCells",
      [0, 1, 2, 3, 4].map((y) => ({ x: 2, y })),
    );
    const html = render(inspector({ kind: "puzzle", id: "p-canal-agua" }, doc));
    expect(html).toContain('data-template-issue="unsolvable"');
    expect(html).toContain("no hay camino de agua del origen al destino");
  });

  it("un deslizante con semilla fija sin semilla muestra el aviso del oráculo", () => {
    const doc = roomPackageToDoc(fixture);
    const sliding = puzzleIn(doc, "p-mural-vendimia");
    setTemplateConfig(doc, sliding, "seed", undefined);
    const html = render(inspector({ kind: "puzzle", id: "p-mural-vendimia" }, doc));
    expect(html).toContain('data-template-issue="unsolvable"');
    expect(html).toContain("la mezcla no es alcanzable");
  });

  it("una configuración fuera del esquema avisa y no monta la vista previa", () => {
    const doc = roomPackageToDoc(fixture);
    const lock = puzzleIn(doc, "p-candado-arca");
    setTemplateConfig(doc, lock, "length", "cuatro");
    const html = render(inspector({ kind: "puzzle", id: "p-candado-arca" }, doc));
    expect(html).toContain('data-template-issue="schema"');
    expect(html).toContain("Configuración incompleta o no válida: length.");
    expect(html).not.toContain("data-template-preview");
  });

  it("los avisos y la vista previa están traducidos en los seis idiomas", () => {
    const catalogs = { es, en, fr, de, nl, pt } as const;
    const doc = roomPackageToDoc(fixture);
    for (const [locale, messages] of Object.entries(catalogs)) {
      const config = (messages as { TemplateConfig: Record<string, unknown> }).TemplateConfig;
      const unsolvable = (config.issues as { unsolvable: Record<string, string> }).unsolvable;
      expect(Object.keys(unsolvable).sort()).toEqual([...PUZZLE_TYPES_MVP].sort());
      const html = render(
        inspector({ kind: "puzzle", id: "p-copas-memoria" }, doc),
        messages,
        locale,
      );
      expect(html).toContain((config.preview as { title: string }).title);
    }
  });
});
