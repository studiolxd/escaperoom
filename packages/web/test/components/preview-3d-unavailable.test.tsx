// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRoomPackage, toRuntimeModel } from "@escaperoom/game-runtime";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { RoomPreviewShell } from "../../src/components/room-preview/room-preview-shell";
import { WorldPreviewShell } from "../../src/components/world-preview/world-preview-shell";
import { findRepoRoot } from "../../src/lib/repo-root";

/** Los canvas montan Phaser: con un modelo 3D no deben montarse nunca. */
const phaserCanvas = vi.hoisted(() => vi.fn());
vi.mock("../../src/components/room-preview/room-preview-canvas", () => ({
  default: () => {
    phaserCanvas();
    return null;
  },
}));
vi.mock("../../src/components/world-preview/world-preview-canvas", () => ({
  default: () => {
    phaserCanvas();
    return null;
  },
}));

const model = toRuntimeModel(
  loadRoomPackage(
    readFileSync(join(findRepoRoot(process.cwd()), "docs/reference/roompackage-demo-3d.v1.json"), "utf8"),
  ),
);

function renderIntl(element: ReactElement) {
  return render(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

afterEach(() => {
  cleanup();
  phaserCanvas.mockClear();
});

describe("previsualizaciones con una sala 3D", () => {
  it.each([
    ["room-preview", RoomPreviewShell],
    ["world-preview", WorldPreviewShell],
  ] as const)("%s muestra el aviso en vez de montar Phaser", (_name, Shell) => {
    renderIntl(createElement(Shell, { model }));
    expect(screen.getByTestId("preview-3d-unavailable")).toHaveTextContent(
      "La previsualización de salas 3D estará disponible con el editor 3D.",
    );
    expect(phaserCanvas).not.toHaveBeenCalled();
  });
});
