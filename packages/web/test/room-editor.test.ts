import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EditToolController,
  placeObject,
  roomDocToPackage,
  roomPackageToDoc,
  setAmbientLight,
  type EditToolController as Controller,
} from "@escaperoom/editor";
import { loadRoomPackage, type EditorPalette } from "@escaperoom/game-runtime";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type * as Y from "yjs";
import es from "../messages/es.json";
import type { RoomEditorCanvasProps } from "../src/components/room-editor/room-editor-canvas";
import { RoomEditorShell } from "../src/components/room-editor/room-editor-shell";
import { RoomEditorWorkspace } from "../src/components/room-editor/room-editor-workspace";
import { manifestFromSources, resolveEditorPalette } from "../src/lib/editor-palette";
import { readReyAldricRoomPackageJson } from "../src/lib/room-preview-fixture";

const fixture = loadRoomPackage(readReyAldricRoomPackageJson());

// `headerActions`/`inspector` son obligatorios en `RoomEditorWorkspace` desde
// F-25 (se borró el fallback "próximamente"); estos tests de
// `<RoomEditorWorkspace>` no cubren esos slots, así que basta un marcador.
const HEADER_ACTIONS = createElement("div", { "data-header-actions": "" });
const INSPECTOR_PLACEHOLDER = createElement("div", { "data-inspector-placeholder": "" });

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

function setup(): { doc: Y.Doc; controller: Controller; palette: EditorPalette } {
  const doc = roomPackageToDoc(fixture);
  const controller = new EditToolController(doc, { roomId: "salon-trono" });
  return { doc, controller, palette: resolveEditorPalette("medieval-v1").palette };
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("palette del editor (pack medieval-v1)", () => {
  it("sale del pack del repo: tiles con capa propuesta y sprites con miniatura", () => {
    const { palette } = resolveEditorPalette("medieval-v1");
    expect(palette.packId).toBe("medieval-v1");
    const tileIds = palette.tiles.map((tile) => tile.tileId);
    expect(tileIds).toEqual(expect.arrayContaining([1, 2, 3, 10]));
    expect(palette.tiles.find((tile) => tile.tileId === 10)).toMatchObject({
      collides: true,
      layer: "walls",
    });
    expect(palette.tiles.find((tile) => tile.tileId === 1)?.layer).toBe("ground");
    const trono = palette.sprites.find((entry) => entry.sprite === "trono");
    expect(trono?.thumbnail).toBe("/packs/medieval-v1/sprites/trono.png");
  });

  it("sin manifiesto generado se deriva de las fuentes y de pack.config.json", () => {
    const root = mkdtempSync(join(tmpdir(), "editor-palette-"));
    const packDir = join(root, "demo-v1");
    mkdirSync(join(packDir, "tiles"), { recursive: true });
    mkdirSync(join(packDir, "sprites"), { recursive: true });
    for (const file of ["tile-1.svg", "tile-10.png", "tile-0.svg", "notas.txt"]) {
      writeFileSync(join(packDir, "tiles", file), "");
    }
    writeFileSync(join(packDir, "sprites", "arca.svg"), "");
    writeFileSync(join(packDir, "pack.config.json"), JSON.stringify({ collides: { "10": true } }));

    expect(manifestFromSources(packDir, "demo-v1")).toEqual({
      id: "demo-v1",
      tiles: {
        "1": { frame: "tile-1", collides: false },
        "10": { frame: "tile-10", collides: true },
      },
      sprites: { arca: { frame: "arca" } },
    });
    const { palette, pack } = resolveEditorPalette("demo-v1", { packsRoot: root });
    expect(pack).toBeUndefined();
    expect(palette.tiles.map((tile) => [tile.tileId, tile.layer, tile.thumbnail])).toEqual([
      [1, "ground", "/packs/demo-v1/tiles/tile-1.svg"],
      [10, "walls", "/packs/demo-v1/tiles/tile-10.png"],
    ]);
  });
});

describe("<RoomEditorWorkspace> — render", () => {
  it("pinta cabecera, herramientas, capas, habitaciones y palette desde el doc Yjs", () => {
    const { doc, controller, palette } = setup();
    const html = render(
      createElement(RoomEditorWorkspace, {
        doc,
        controller,
        palette,
        status: "connected",
        validation: createElement("div", { "data-validation-slot": "" }),
        headerActions: HEADER_ACTIONS,
        inspector: INSPECTOR_PLACEHOLDER,
      }),
    );

    expect(html).toContain("La Maldición del Rey Aldric");
    expect(html).toContain("Guardado automático");
    for (const tool of [
      "Seleccionar",
      "Pincel",
      "Relleno",
      "Borrador",
      "Colocar",
      "Decorar",
      "Antorcha",
    ]) {
      expect(html).toContain(tool);
    }
    for (const layer of ["Suelo", "Muro", "Decoración"]) expect(html).toContain(layer);
    for (const room of fixture.map.rooms) expect(html).toContain(room.name);
    expect(html).toContain('aria-current="page"');
    expect(count(html, 'data-palette="tiles"')).toBe(1);
    expect(count(html, "data-tool=")).toBe(7);
    expect(html).toContain("/packs/medieval-v1/sprites/trono.png");
    // Contador derivado del doc: el trono ya está colocado una vez.
    expect(html).toContain("1 colocado");
    expect(html).toContain("data-header-actions");
    expect(html).toContain("data-inspector-placeholder");
    expect(html).toContain("data-validation-slot");
    // Sin lienzo (SSR), marcador de carga.
    expect(html).toContain("Cargando el lienzo…");
  });

  it("monta el lienzo con el modelo del runtime derivado del doc y la selección", () => {
    const { doc, controller, palette } = setup();
    const id = placeObject(doc, {
      roomId: "salon-trono",
      sprite: "arca",
      position: { x: 4, y: 4 },
    });
    controller.select(id);
    let canvas: RoomEditorCanvasProps | undefined;
    const html = render(
      createElement(RoomEditorWorkspace, {
        doc,
        controller,
        palette,
        status: "local",
        renderCanvas: (props: RoomEditorCanvasProps) => {
          canvas = props;
          return createElement("div", { "data-canvas": props.roomId });
        },
        headerActions: HEADER_ACTIONS,
        inspector: INSPECTOR_PLACEHOLDER,
      }),
    );

    expect(html).toContain('data-canvas="salon-trono"');
    expect(canvas?.model.subrooms.map((room) => room.id)).toEqual(
      fixture.map.rooms.map((room) => room.id),
    );
    expect(canvas?.model.objectsById["arca-trono"]?.position).toEqual({ x: 4, y: 4 });
    expect(canvas?.selectedObjectId).toBe("arca-trono");
    expect(html).toContain("Local (sin sincronizar)");
  });

  it("los eventos del lienzo llegan a la capa de comandos y cambian el doc", () => {
    const { doc, controller, palette } = setup();
    let canvas: RoomEditorCanvasProps | undefined;
    render(
      createElement(RoomEditorWorkspace, {
        doc,
        controller,
        palette,
        status: "local",
        renderCanvas: (props: RoomEditorCanvasProps) => {
          canvas = props;
          return null;
        },
        headerActions: HEADER_ACTIONS,
        inspector: INSPECTOR_PLACEHOLDER,
      }),
    );
    controller.selectSprite("barriles");
    canvas?.onPointer({
      type: "pointer",
      phase: "down",
      cell: { x: 3, y: 5 },
      inside: true,
      roomId: "salon-trono",
    });
    expect(controller.getState().selectedObjectId).toBe("barriles-trono");
    const objects = doc.getMap("objects");
    expect(objects.has("barriles-trono")).toBe(true);
  });
});

describe("<RoomEditorWorkspace> — decoración e iluminación de la habitación", () => {
  it("el panel de la sala lista decoración, antorchas y luz ambiente del doc", () => {
    const { doc, controller, palette } = setup();
    const html = render(
      createElement(RoomEditorWorkspace, {
        doc,
        controller,
        palette,
        status: "local",
        headerActions: HEADER_ACTIONS,
        inspector: INSPECTOR_PLACEHOLDER,
      }),
    );
    const salon = fixture.map.rooms[0]!;
    expect(html).toContain('data-room-panel="salon-trono"');
    expect(html).toContain(`Habitación «${salon.name}»`);
    expect(count(html, "data-decoration=")).toBe(salon.decorations.length);
    // Antorcha del brasero: celda y objeto que la gobierna (el <select> de
    // objeto es un Select de shadcn — su valor seleccionado se cubre en
    // test/room-editor-select.test.ts, con jsdom, ya que Radix monta el
    // listbox en un Portal que `renderToStaticMarkup` no renderiza).
    expect(count(html, "data-torch=")).toBe(1);
    expect(html).toContain('value="#3a2f22"');
    expect(html).toContain("data-ambient-light");
    expect(html).toContain("Quitar luz ambiente");
    // Modo «Colocar» por defecto en la palette.
    expect(html).toContain('data-palette-mode="place"');
  });

  it("las herramientas Decorar y Antorcha escriben en el doc y el panel lo refleja", () => {
    const { doc, controller, palette } = setup();
    let canvas: RoomEditorCanvasProps | undefined;
    const workspace = () =>
      createElement(RoomEditorWorkspace, {
        doc,
        controller,
        palette,
        status: "local",
        renderCanvas: (props: RoomEditorCanvasProps) => {
          canvas = props;
          return null;
        },
        headerActions: HEADER_ACTIONS,
        inspector: INSPECTOR_PLACEHOLDER,
      });
    render(workspace());
    const pointer = (x: number, y: number, objectId?: string) =>
      canvas?.onPointer({
        type: "pointer",
        phase: "down",
        cell: { x, y },
        inside: true,
        roomId: "salon-trono",
        ...(objectId ? { objectId } : {}),
      });

    controller.selectDecorationSprite("barriles");
    pointer(8, 8);
    controller.setTool("torch");
    pointer(3, 3);

    const salon = roomDocToPackage(doc).map.rooms[0]!;
    expect(salon.decorations.at(-1)).toEqual({ sprite: "barriles", x: 8, y: 8 });
    expect(salon.lighting.at(-1)).toEqual({ type: "torch", x: 3, y: 3 });
    expect(roomDocToPackage(doc).objects).toHaveLength(fixture.objects.length);
    // El lienzo recibe la decoración nueva por el modelo del runtime.
    const html = render(workspace());
    expect(canvas?.model.subroomsById["salon-trono"]?.decorations).toContainEqual({
      sprite: "barriles",
      x: 8,
      y: 8,
    });
    expect(count(html, "data-decoration=")).toBe(fixture.map.rooms[0]!.decorations.length + 1);
    expect(count(html, "data-torch=")).toBe(2);
  });

  it("en modo Decorar la palette lo indica y una habitación sin luces ofrece añadirlas", () => {
    const { doc, controller, palette } = setup();
    setAmbientLight(doc, "bodega", null);
    controller.setRoom("bodega");
    controller.selectDecorationSprite("barriles");
    const html = render(
      createElement(RoomEditorWorkspace, {
        doc,
        controller,
        palette,
        status: "local",
        headerActions: HEADER_ACTIONS,
        inspector: INSPECTOR_PLACEHOLDER,
      }),
    );
    expect(html).toContain('data-palette-mode="decorate"');
    expect(html).toContain("Haz clic en el lienzo para colocar «barriles» como decoración.");
    expect(html).toContain('data-room-panel="bodega"');
    expect(html).toContain("Añadir luz ambiente");
    expect(html).not.toContain("data-ambient-light");
  });
});

describe("<RoomEditorShell> — SSR", () => {
  it("en servidor muestra la conexión al borrador (el doc se crea en el cliente)", () => {
    const html = render(
      createElement(RoomEditorShell, {
        roomId: "room-rey-aldric",
        palette: resolveEditorPalette("medieval-v1").palette,
        syncUrl: "ws://localhost:2568",
      }),
    );
    expect(html).toContain("Conectando con el borrador…");
  });
});
