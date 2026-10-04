// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Edit3DController,
  roomDocToPackage,
  roomPackageToDoc,
  type EditTarget,
} from "@escaperoom/editor";
import { loadRoomPackage, loadRuntimeModel } from "@escaperoom/game-runtime";
import { getModels3DCatalog } from "@escaperoom/shared/packs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { findRepoRoot } from "../../src/lib/repo-root";

/** jsdom no tiene WebGL ni WASM: el runtime 3D y la navmesh se sustituyen por dobles. */
const runtimes = vi.hoisted(() => [] as Record<string, any>[]);
const reach = vi.hoisted(() => ({ issues: [] as unknown[] }));

vi.mock("@escaperoom/game-runtime/three", () => ({
  RoomRuntime3D: class {
    options: Record<string, unknown>;
    ready = Promise.resolve();
    currentRoomId: string;
    handlers: { event?: (e: unknown) => void; transform?: (c: unknown, f: boolean) => void } = {};
    setModel = vi.fn();
    showRoom = vi.fn();
    setSelection = vi.fn();
    setGhost = vi.fn();
    setWorkHeight = vi.fn();
    setGizmoMode = vi.fn();
    setSnap = vi.fn();
    setNavmeshVisible = vi.fn();
    destroy = vi.fn();
    onEditEvent = vi.fn((h: (e: unknown) => void) => {
      this.handlers.event = h;
      return () => {};
    });
    onTransform = vi.fn((h: (c: unknown, f: boolean) => void) => {
      this.handlers.transform = h;
      return () => {};
    });
    constructor(_parent: HTMLElement, _model: unknown, options: Record<string, unknown>) {
      this.options = options;
      this.currentRoomId = String(options.initialRoomId);
      runtimes.push(this as unknown as Record<string, any>);
    }
  },
}));
vi.mock("@escaperoom/nav3d", () => ({
  initNav3D: () => Promise.resolve(),
  checkRoomReach: () => reach.issues,
}));

// Radix (Switch, Slider) mide con ResizeObserver, que jsdom no trae.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import RoomEditorCanvas3D from "../../src/components/room-editor/room-editor-canvas-3d";
import { RoomEditorPalette3D } from "../../src/components/room-editor/room-editor-palette-3d";
import { RoomEditorRoomPanel3D } from "../../src/components/room-editor/room-editor-room-panel-3d";
import { RoomEditorSelectionPanel3D } from "../../src/components/room-editor/room-editor-selection-panel-3d";
import { RoomEditorWorkspace3D } from "../../src/components/room-editor/room-editor-workspace-3d";

const repo = findRepoRoot(process.cwd());
const demoJson = readFileSync(join(repo, "docs/reference/roompackage-demo-3d.v1.json"), "utf8");
const demoPkg = loadRoomPackage(demoJson);
const catalog = getModels3DCatalog("medieval-v1");

function withIntl(element: ReactElement) {
  return createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element });
}

function setup() {
  const doc = roomPackageToDoc(demoPkg);
  const roomId = demoPkg.map.rooms[0]!.id;
  const controller = new Edit3DController(doc, { roomId });
  return { doc, controller, roomId };
}

afterEach(() => {
  cleanup();
  runtimes.length = 0;
  reach.issues = [];
  window.localStorage.clear();
});

function renderWorkspace(extra: Partial<Parameters<typeof RoomEditorWorkspace3D>[0]> = {}) {
  const { doc, controller } = setup();
  const view = render(
    withIntl(
      createElement(RoomEditorWorkspace3D, {
        doc,
        controller,
        status: "local",
        inspector: createElement("div", { "data-inspector": "" }),
        headerActions: createElement("div"),
        ...extra,
      }),
    ),
  );
  return { doc, controller, ...view };
}

describe("RoomEditorWorkspace3D — barra y atajos", () => {
  it("las herramientas, el gizmo, la altura y los interruptores llaman al controlador", async () => {
    const user = userEvent.setup();
    const { controller, container } = renderWorkspace();
    const q = <T extends Element>(selector: string) => container.querySelector<T>(selector)!;

    await user.click(q("[data-tool=place]"));
    expect(controller.getState().tool).toBe("place");
    expect(q("[data-tool=place]")).toHaveAttribute("aria-pressed", "true");
    // El gizmo solo se ofrece con `select`.
    expect(container.querySelector("[data-gizmo]")).toBeNull();
    await user.click(q("[data-tool=select]"));
    await user.click(q("[data-gizmo=rotate]"));
    expect(controller.getState().gizmoMode).toBe("rotate");
    expect(q("[data-gizmo=rotate]")).toHaveAttribute("aria-pressed", "true");

    await user.click(q("[data-work-height=up]"));
    await user.click(q("[data-work-height=up]"));
    expect(controller.getState().workHeight).toBe(0.4);
    await user.click(q("[data-work-height=down]"));
    expect(controller.getState().workHeight).toBe(0.2);
    const field = q<HTMLInputElement>("[data-work-height=value]");
    await user.clear(field);
    await user.type(field, "1.4{Enter}");
    expect(controller.getState().workHeight).toBe(1.4);

    expect(controller.getState().snapEnabled).toBe(true);
    await user.click(q("[data-snap]"));
    expect(controller.getState().snapEnabled).toBe(false);
    await user.click(q("[data-show-navmesh]"));
    expect(q("[data-show-navmesh]")).toHaveAttribute("aria-checked", "true");
  });

  it("atajos W/E/R, Q, Supr, Ctrl+D y Esc", () => {
    const { controller } = renderWorkspace();
    const rotate = vi.spyOn(controller, "rotatePlacement");
    const del = vi.spyOn(controller, "deleteSelection");
    const dup = vi.spyOn(controller, "duplicateSelection");

    controller.setTool("place");
    fireEvent.keyDown(window, { key: "e" });
    expect(controller.getState()).toMatchObject({ tool: "select", gizmoMode: "rotate" });
    fireEvent.keyDown(window, { key: "r" });
    expect(controller.getState().gizmoMode).toBe("scale");
    fireEvent.keyDown(window, { key: "w" });
    expect(controller.getState().gizmoMode).toBe("translate");
    fireEvent.keyDown(window, { key: "q" });
    expect(rotate).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(del).toHaveBeenCalledTimes(2);
    const prevented = !fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(prevented).toBe(true);
    fireEvent.keyDown(window, { key: "d", metaKey: true });
    expect(dup).toHaveBeenCalledTimes(2);

    controller.setTool("spawn");
    controller.select([{ kind: "piece", id: "x" }]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(controller.getState()).toMatchObject({ tool: "select", selection: [] });
  });

  it("los atajos no actúan con el foco en un campo de texto", () => {
    const { controller, container } = renderWorkspace();
    const rotate = vi.spyOn(controller, "rotatePlacement");
    const del = vi.spyOn(controller, "deleteSelection");
    const input = container.querySelector<HTMLInputElement>("[data-work-height=value]")!;
    fireEvent.keyDown(input, { key: "q" });
    fireEvent.keyDown(input, { key: "Delete" });
    fireEvent.keyDown(input, { key: "e" });
    expect(rotate).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(controller.getState().gizmoMode).toBe("translate");
  });

  it("no actúan en la pestaña de reglas", () => {
    const { controller } = renderWorkspace({
      rulesGraph: createElement("div"),
      canvasTab: "rules",
    });
    const rotate = vi.spyOn(controller, "rotatePlacement");
    fireEvent.keyDown(window, { key: "q" });
    expect(rotate).not.toHaveBeenCalled();
  });

  it("pasa al lienzo el estado del controlador y Alt desactiva el imán mientras dure", () => {
    const renderCanvas = vi.fn(() => null);
    const { controller } = renderWorkspace({ renderCanvas });
    const last = () => renderCanvas.mock.calls.at(-1)![0] as { altPressed: boolean; state: unknown };
    expect(last().altPressed).toBe(false);
    act(() => {
      fireEvent.keyDown(window, { key: "Alt" });
    });
    expect(last().altPressed).toBe(true);
    act(() => {
      fireEvent.keyUp(window, { key: "Alt" });
    });
    expect(last().altPressed).toBe(false);
    expect(last().state).toBe(controller.getState());
  });
});

describe("RoomEditorPalette3D", () => {
  const entries = Object.entries(catalog!.models);

  it("lista el catálogo por pestañas y categorías, y elegir llama a selectModel", async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    render(
      withIntl(
        createElement(RoomEditorPalette3D, {
          catalog,
          customModels: undefined,
          placing: undefined,
          onSelectModel,
        }),
      ),
    );
    const kitEntry = entries.find(([, e]) => ["suelo", "muro", "estructura"].includes(e.category))!;
    const objectEntry = entries.find(([, e]) => ["mueble", "pared", "suelto"].includes(e.category))!;
    expect(screen.getByText("Suelo")).toBeInTheDocument();
    expect(document.querySelector(`[data-model="${objectEntry[0]}"]`)).toBeNull();

    await user.click(document.querySelector(`[data-model="${kitEntry[0]}"]`)!);
    expect(onSelectModel).toHaveBeenLastCalledWith(kitEntry[0], "piece", kitEntry[1].snap);

    await user.click(screen.getByRole("tab", { name: "Objetos" }));
    expect(document.querySelector(`[data-model="${kitEntry[0]}"]`)).toBeNull();
    await user.click(document.querySelector(`[data-model="${objectEntry[0]}"]`)!);
    expect(onSelectModel).toHaveBeenLastCalledWith(objectEntry[0], "object", false);

    // El conmutador de decoración cambia `as` a pieza.
    await user.click(document.querySelector("[data-as-decoration]")!);
    await user.click(document.querySelector(`[data-model="${objectEntry[0]}"]`)!);
    expect(onSelectModel).toHaveBeenLastCalledWith(objectEntry[0], "piece", false);
  });

  it("«Mis modelos» muestra los de la sala o el aviso de vacío; aria-pressed marca el activo", async () => {
    const user = userEvent.setup();
    const onSelectModel = vi.fn();
    const props = { catalog, placing: undefined, onSelectModel };
    const { rerender } = render(
      withIntl(createElement(RoomEditorPalette3D, { ...props, customModels: {} })),
    );
    await user.click(screen.getByRole("tab", { name: "Mis modelos" }));
    expect(screen.getByText("Aún no has subido modelos.")).toBeInTheDocument();

    rerender(
      withIntl(
        createElement(RoomEditorPalette3D, {
          ...props,
          placing: { model: "mi-arca", as: "object", snap: false },
          customModels: {
            "mi-arca": {
              ref: "upload:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              label: "Mi arca",
              size: { w: 1, d: 0.6, hgt: 0.6 },
              colliders: [],
              clips: [],
            },
          },
        }),
      ),
    );
    const button = document.querySelector<HTMLElement>('[data-model="mi-arca"]')!;
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(within(button).getByText("1 × 0.6 × 0.6 m")).toBeInTheDocument();
    await user.click(button);
    expect(onSelectModel).toHaveBeenCalledWith("mi-arca", "object", false);
  });
});

describe("RoomEditorSelectionPanel3D", () => {
  it("edita un x y llama a transform(..., true)", async () => {
    const user = userEvent.setup();
    const { doc, controller, roomId } = setup();
    const pkg = roomDocToPackage(doc);
    const object = pkg.objects.find((o) => o.roomId === roomId && o.transform)!;
    const transform = vi.spyOn(controller, "transform");
    render(
      withIntl(
        createElement(RoomEditorSelectionPanel3D, {
          pkg,
          roomId,
          selection: [{ kind: "object", id: object.id }],
          controller,
        }),
      ),
    );
    const x = document.querySelector<HTMLInputElement>("[data-field=x]")!;
    await user.clear(x);
    await user.type(x, "2.5{Enter}");
    expect(transform).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: "object", id: object.id, x: 2.5, y: object.transform!.y })],
      true,
    );
  });

  it("con varios elementos muestra el recuento y Duplicar / Borrar", async () => {
    const user = userEvent.setup();
    const { doc, controller, roomId } = setup();
    const duplicate = vi.spyOn(controller, "duplicateSelection");
    const del = vi.spyOn(controller, "deleteSelection");
    const selection: EditTarget[] = [
      { kind: "spawn", id: "spawn-1" },
      { kind: "torch", index: 0 },
    ];
    render(
      withIntl(
        createElement(RoomEditorSelectionPanel3D, {
          pkg: roomDocToPackage(doc),
          roomId,
          selection,
          controller,
        }),
      ),
    );
    expect(screen.getByText("2 elementos seleccionados")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Duplicar" }));
    await user.click(screen.getByRole("button", { name: "Borrar" }));
    expect(duplicate).toHaveBeenCalled();
    expect(del).toHaveBeenCalled();
  });
});

describe("RoomEditorRoomPanel3D", () => {
  it("muestra el aviso de alcance y, al pulsarlo, selecciona el elemento", async () => {
    const user = userEvent.setup();
    reach.issues = [{ code: "object_unreachable", objectId: "arca" }, { code: "spawn_off_navmesh", spawnId: "spawn-2" }];
    const { doc, roomId } = setup();
    const onSelect = vi.fn();
    render(
      withIntl(
        createElement(RoomEditorRoomPanel3D, {
          doc,
          pkg: roomDocToPackage(doc),
          roomId,
          onSelect,
          errorText: (e) => e.message,
        }),
      ),
    );
    const warning = await screen.findByText("No se puede llegar hasta arca.", {}, { timeout: 3000 });
    expect(screen.getByText("El punto de aparición spawn-2 está fuera de la zona transitable.")).toBeInTheDocument();
    expect(
      screen.getByText("Una tarima o plataforma aislada de 1 × 1 m no se puede pisar: junta al menos dos."),
    ).toBeInTheDocument();
    await user.click(warning);
    expect(onSelect).toHaveBeenCalledWith([{ kind: "object", id: "arca" }]);
  });

  it("cambia las medidas con setRoomBounds3D y avisa de no_floor", async () => {
    const user = userEvent.setup();
    reach.issues = [{ code: "no_floor" }];
    const { doc, roomId } = setup();
    const pkg = roomDocToPackage(doc);
    render(
      withIntl(
        createElement(RoomEditorRoomPanel3D, {
          doc,
          pkg,
          roomId,
          onSelect: vi.fn(),
          errorText: (e) => e.message,
        }),
      ),
    );
    expect(await screen.findByText("Esta habitación no tiene suelo transitable.", {}, { timeout: 3000 })).toBeInTheDocument();
    const width = document.querySelector<HTMLInputElement>("[data-room-size=cols]")!;
    const before = pkg.map.rooms.find((r) => r.id === roomId)!.grid.cols;
    await user.clear(width);
    await user.type(width, `${before + 1}{Enter}`);
    const after = roomDocToPackage(doc).map.rooms.find((r) => r.id === roomId)!.grid.cols;
    expect(after).toBe(before + 1);
  });
});

describe("RoomEditorCanvas3D", () => {
  const model = loadRuntimeModel(demoJson);
  const roomId = model.initialRoomId;

  it("monta el runtime en modo edición y lo conecta al controlador", async () => {
    const { controller } = setup();
    const pointer = vi.spyOn(controller, "pointer");
    const transform = vi.spyOn(controller, "transform");
    render(
      createElement(RoomEditorCanvas3D, {
        model,
        roomId,
        pack3d: { baseUrl: "/packs/medieval-v1", packId: "medieval-v1" },
        controller,
        state: controller.getState(),
        altPressed: false,
        navmeshVisible: true,
      }),
    );
    await waitFor(() => expect(runtimes).toHaveLength(1));
    const runtime = runtimes[0]!;
    expect(runtime.options).toMatchObject({
      mode: "edit",
      initialRoomId: roomId,
      packBaseUrl: "/packs/medieval-v1",
      packId: "medieval-v1",
    });
    expect(runtime.setSnap).toHaveBeenLastCalledWith({ move: 1, yaw: 90 });
    expect(runtime.setGizmoMode).toHaveBeenLastCalledWith("translate");
    expect(runtime.setNavmeshVisible).toHaveBeenLastCalledWith(true);

    runtime.handlers.event!({
      type: "click",
      point: { x: 1, y: 1, h: 0 },
      target: { kind: "none" },
      button: 0,
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });
    expect(pointer).toHaveBeenCalledWith({
      type: "click",
      point: { x: 1, y: 1, h: 0 },
      target: { kind: "none" },
      shiftKey: true,
      altKey: false,
    });

    runtime.handlers.transform!(
      [{ target: { kind: "torch", index: 1 }, x: 1, y: 2, h: 2, yaw: 10, scale: 1 }],
      false,
    );
    expect(transform).toHaveBeenCalledWith([{ kind: "torch", index: 1, x: 1, y: 2, h: 2 }], false);
  });

  it("actualiza imán, gizmo y habitación cuando cambian las propiedades", async () => {
    const { controller } = setup();
    const base = {
      model,
      roomId,
      controller,
      altPressed: false,
      navmeshVisible: false,
    };
    const { rerender } = render(
      createElement(RoomEditorCanvas3D, { ...base, state: controller.getState() }),
    );
    await waitFor(() => expect(runtimes).toHaveLength(1));
    const runtime = runtimes[0]!;
    rerender(createElement(RoomEditorCanvas3D, { ...base, altPressed: true, state: controller.getState() }));
    expect(runtime.setSnap).toHaveBeenLastCalledWith({ move: 0, yaw: 0 });
    controller.setTool("place");
    rerender(createElement(RoomEditorCanvas3D, { ...base, state: controller.getState() }));
    expect(runtime.setGizmoMode).toHaveBeenLastCalledWith(null);
    const other = model.subrooms.find((r) => r.id !== roomId);
    if (other) {
      rerender(createElement(RoomEditorCanvas3D, { ...base, roomId: other.id, state: controller.getState() }));
      expect(runtime.showRoom).toHaveBeenCalledWith(other.id);
    }
  });
});
