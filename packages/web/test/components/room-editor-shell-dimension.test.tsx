// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { RoomEditorShell } from "../../src/components/room-editor/room-editor-shell";
import { resolveEditorPalette } from "../../src/lib/editor-palette";
import { readReyAldricRoomPackageJson } from "../../src/lib/room-preview-fixture";
import { findRepoRoot } from "../../src/lib/repo-root";

/** Los lienzos reales (Phaser, Three) no corren en jsdom: se sustituyen por marcadores. */
vi.mock("../../src/components/room-editor/room-editor-canvas", () => ({
  default: () => createElement("div", { "data-canvas": "2d" }),
}));
vi.mock("../../src/components/room-editor/room-editor-canvas-3d", () => ({
  default: () => createElement("div", { "data-canvas": "3d" }),
}));
vi.mock("@escaperoom/nav3d", () => ({
  initNav3D: () => Promise.resolve(),
  checkRoomReach: () => [],
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

const demo3d = loadRoomPackage(
  readFileSync(
    join(findRepoRoot(process.cwd()), "docs/reference/roompackage-demo-3d.v1.json"),
    "utf8",
  ),
);
const demo2d = loadRoomPackage(readReyAldricRoomPackageJson());

function renderShell(demoPackage: typeof demo2d) {
  return render(
    createElement(NextIntlClientProvider, {
      locale: "es",
      messages: es,
      children: createElement(RoomEditorShell, {
        roomId: "sala",
        palette: resolveEditorPalette("medieval-v1").palette,
        syncUrl: "ws://localhost:0",
        demoPackage,
        pack3d: { packId: "medieval-v1" },
      }),
    }),
  );
}

describe("RoomEditorShell — elección del editor según la dimensión", () => {
  it("una sala 3D pinta el espacio de trabajo 3D", async () => {
    const { container } = renderShell(demo3d);
    expect(await screen.findByTestId("room-editor")).toHaveAttribute("data-dimension", "3d");
    expect(container.querySelector("[data-tool=spawn]")).not.toBeNull();
    expect(container.querySelector("[data-tool=brush]")).toBeNull();
    expect(await screen.findByRole("tab", { name: "Kit" })).toBeInTheDocument();
    expect(await screen.findByText("Zona transitable")).toBeInTheDocument();
  });

  it("una sala 2D pinta el espacio de trabajo 2D", async () => {
    const { container } = renderShell(demo2d);
    const root = await screen.findByTestId("room-editor");
    expect(root).not.toHaveAttribute("data-dimension");
    expect(container.querySelector("[data-tool=brush]")).not.toBeNull();
    expect(container.querySelector("[data-tool=spawn]")).toBeNull();
  });
});
