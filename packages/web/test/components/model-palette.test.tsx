// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listCustomModels3D,
  placePieces3D,
  roomPackageToDoc,
  setCustomModel3D,
} from "@escaperoom/editor";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { getModels3DCatalog } from "@escaperoom/shared/packs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { findRepoRoot } from "../../src/lib/repo-root";

// jsdom no tiene WebGL: el visor se sustituye en todos los tests.
vi.mock("../../src/components/models/model-viewer-3d", () => ({
  default: ({ url }: { url: string }) => createElement("div", { "data-testid": "viewer", "data-url": url }),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { ModelUploadButton, proposeModelId } from "../../src/components/room-editor/model-upload-button";
import { RoomEditorPalette3D } from "../../src/components/room-editor/room-editor-palette-3d";

const repo = findRepoRoot(process.cwd());
const pkg = loadRoomPackage(readFileSync(join(repo, "docs/reference/roompackage-demo-3d.v1.json"), "utf8"));
const catalog = getModels3DCatalog("medieval-v1");
const roomId = pkg.map.rooms[0]!.id;

const box = { type: "box" as const, cx: 0, cy: 0, ch: 0.3, sx: 1, sy: 0.6, sh: 0.6 };
const mesa = {
  ref: "media:11111111-1111-4111-8111-111111111111",
  label: "Mesa",
  size: { w: 1, d: 0.6, hgt: 0.6 },
  colliders: [box],
  clips: [],
};

const intl = (el: React.ReactElement) =>
  createElement(NextIntlClientProvider, { locale: "es", messages: es, children: el });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function paletteWith(doc = roomPackageToDoc(pkg)) {
  setCustomModel3D(doc, "taburete", mesa);
  const view = render(
    intl(
      createElement(RoomEditorPalette3D, {
        doc,
        roomId,
        catalog,
        customModels: Object.fromEntries(listCustomModels3D(doc).map(({ id, ...m }) => [id, m])),
        placing: undefined,
        onSelectModel: vi.fn(),
      }),
    ),
  );
  return { doc, ...view };
}

describe("«Mis modelos»: bloqueo y borrado", () => {
  it("el Switch «Bloquea el paso» quita y devuelve el colisionador", async () => {
    const user = userEvent.setup();
    const { doc } = paletteWith();
    await user.click(screen.getByRole("tab", { name: "Mis modelos" }));
    const toggle = document.querySelector<HTMLElement>('[data-blocks="taburete"]')!;
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    expect(listCustomModels3D(doc).find((m) => m.id === "taburete")!.colliders).toEqual([]);
  });

  it("al activarlo pone una caja de su tamaño", async () => {
    const user = userEvent.setup();
    const doc = roomPackageToDoc(pkg);
    setCustomModel3D(doc, "taburete", { ...mesa, colliders: [] });
    render(
      intl(
        createElement(RoomEditorPalette3D, {
          doc,
          roomId,
          catalog,
          customModels: { taburete: { ...mesa, colliders: [] } },
          placing: undefined,
          onSelectModel: vi.fn(),
        }),
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Mis modelos" }));
    await user.click(document.querySelector('[data-blocks="taburete"]')!);
    expect(listCustomModels3D(doc).find((m) => m.id === "taburete")!.colliders).toEqual([
      { type: "box", cx: 0, cy: 0, ch: 0.3, sx: 1, sy: 0.6, sh: 0.6 },
    ]);
  });

  it("borrar quita el modelo; si está en uso muestra el error REFERENCED_ID", async () => {
    const user = userEvent.setup();
    const doc = roomPackageToDoc(pkg);
    placePieces3D(doc, roomId, [{ model: "taburete", x: 1, y: 1, h: 0, yaw: 0 }]);
    const { doc: same } = paletteWith(doc);
    await user.click(screen.getByRole("tab", { name: "Mis modelos" }));
    await user.click(screen.getByRole("button", { name: "Borrar modelo" }));
    expect(document.querySelector("[data-mine-error]")).toHaveTextContent(/se usa en la pieza/);
    expect(listCustomModels3D(same).some((m) => m.id === "taburete")).toBe(true);
  });

  it("borrar un modelo libre lo quita del documento", async () => {
    const user = userEvent.setup();
    const { doc } = paletteWith();
    await user.click(screen.getByRole("tab", { name: "Mis modelos" }));
    await user.click(screen.getByRole("button", { name: "Borrar modelo" }));
    expect(listCustomModels3D(doc).some((m) => m.id === "taburete")).toBe(false);
  });
});

describe("proposeModelId", () => {
  it("slug del nombre sin extensión, con sufijo si ya existe", () => {
    expect(proposeModelId("Mi Arca.glb", new Set())).toBe("mi-arca");
    expect(proposeModelId("Mi Arca.glb", new Set(["mi-arca"]))).toBe("mi-arca-2");
    expect(proposeModelId("Mi Arca.glb", new Set(["mi-arca", "mi-arca-2"]))).toBe("mi-arca-3");
  });
});

describe("<ModelUploadButton>", () => {
  const result = {
    ref: "media:22222222-2222-4222-8222-222222222222",
    size: { w: 2, d: 1, hgt: 1.5 },
    colliders: [{ type: "box", cx: 0, cy: 0, ch: 0.75, sx: 2, sy: 1, sh: 1.5 }],
    clips: ["abrir"],
    triangles: 1200,
    byteSize: 2 * 1024 * 1024,
  };

  function mountButton(takenIds: string[] = [], customCount = 0) {
    const doc = roomPackageToDoc(pkg);
    const view = render(
      intl(
        createElement(ModelUploadButton, {
          doc,
          roomId,
          takenIds: new Set<string>(takenIds),
          catalogIds: new Set<string>(),
          customCount,
        }),
      ),
    );
    return { doc, ...view };
  }

  const pickFile = async (file: File) => {
    const input = document.querySelector<HTMLInputElement>("[data-model-file]")!;
    await userEvent.setup().upload(input, file);
  };

  const glb = (name = "Arca Vieja.glb", size = 1000) =>
    new File([new Uint8Array(size)], name, { type: "model/gltf-binary" });

  it("ciclo completo: reserva, PUT, complete, diálogo y setCustomModel3D con el id propuesto", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/models") && init?.method === "POST")
          return Response.json({ assetId: "a1", uploadUrl: "https://bucket/put", headers: { "x-h": "1" } }, { status: 201 });
        if (url === "https://bucket/put") return new Response(null, { status: 200 });
        if (url.endsWith("/complete")) return Response.json(result);
        return Response.json({ url: "https://s/arca.glb" });
      }),
    );
    const user = userEvent.setup();
    const { doc } = mountButton();
    await pickFile(glb());
    await screen.findByRole("dialog");
    expect(calls.slice(0, 3)).toEqual([
      `POST /api/rooms/${roomId}/models`,
      "PUT https://bucket/put",
      `POST /api/rooms/${roomId}/models/a1/complete`,
    ]);
    expect(screen.getByLabelText("Identificador")).toHaveValue("arca-vieja");
    expect(screen.getByText("2 × 1 × 1.5 m")).toBeInTheDocument();
    expect(screen.getByText("1200 triángulos")).toBeInTheDocument();
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-url", "https://s/arca.glb");
    await user.click(screen.getByRole("button", { name: "Añadir" }));
    expect(listCustomModels3D(doc).find((m) => m.id === "arca-vieja")).toMatchObject({
      ref: result.ref,
      label: "Arca Vieja",
      size: result.size,
      clips: ["abrir"],
    });
  });

  it("un id repetido propone el sufijo -2", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/models") && init?.method === "POST")
          return Response.json({ assetId: "a1", uploadUrl: "https://bucket/put" }, { status: 201 });
        if (url === "https://bucket/put") return new Response(null, { status: 200 });
        if (url.endsWith("/complete")) return Response.json(result);
        return Response.json({ url: "https://s/arca.glb" });
      }),
    );
    mountButton(["arca-vieja"]);
    await pickFile(glb());
    expect(await screen.findByLabelText("Identificador")).toHaveValue("arca-vieja-2");
  });

  it("más de 15 MB: avisa sin llamar al servidor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mountButton();
    await pickFile(glb("grande.glb", 15 * 1024 * 1024 + 1));
    expect(await screen.findByText("El fichero supera los 15 MB.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un 422 muestra el mensaje del servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/models") && init?.method === "POST")
          return Response.json({ assetId: "a1", uploadUrl: "https://bucket/put" }, { status: 201 });
        if (url === "https://bucket/put") return new Response(null, { status: 200 });
        return Response.json(
          { error: { code: "VALIDATION_ERROR", message: "El modelo tiene 180.000 triángulos; el máximo es 100.000" } },
          { status: 422 },
        );
      }),
    );
    mountButton();
    await pickFile(glb());
    await waitFor(() =>
      expect(document.querySelector("[data-model-upload-error]")).toHaveTextContent(/180\.000 triángulos/),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("con 40 modelos el botón está desactivado y lo explica", () => {
    mountButton([], 40);
    expect(document.querySelector("[data-model-upload]")).toBeDisabled();
    expect(screen.getByText("Has llegado al máximo de 40 modelos por sala.")).toBeInTheDocument();
  });
});
