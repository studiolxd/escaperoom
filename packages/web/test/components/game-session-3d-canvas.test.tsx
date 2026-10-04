// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRoomPackage, toRuntimeModel } from "@escaperoom/game-runtime";
import { withLobbyRoom } from "@escaperoom/shared/schemas";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { createLocalGameClient } from "@escaperoom/game-runtime/session";
import { GameSessionShell } from "../../src/components/game-session/game-session-shell";
import { findRepoRoot } from "../../src/lib/repo-root";
import { readReyAldricRoomPackageJson } from "../../src/lib/room-preview-fixture";

/**
 * 7.6: el shell elige el canvas por `model.dimension` (una partida 2D no descarga Three.js ni una
 * 3D, Phaser) y el playtest de una sala 3D funciona con el mismo shell. jsdom no tiene WebGL:
 * ambos canvas se sustituyen por un marcador.
 */

const canvas3d = vi.hoisted(() => vi.fn());
vi.mock("../../src/components/game-session/game-session-canvas-3d", () => ({
  default: (props: unknown) => {
    canvas3d(props);
    return createElement("div", { "data-testid": "canvas-3d" });
  },
}));
vi.mock("../../src/components/game-session/game-session-canvas", () => ({
  default: () => createElement("div", { "data-testid": "canvas-2d" }),
}));

const roomPackage = loadRoomPackage(
  readFileSync(join(findRepoRoot(process.cwd()), "docs/reference/roompackage-demo-3d.v1.json"), "utf8"),
);
const model = toRuntimeModel(withLobbyRoom(roomPackage));

function renderIntl(element: ReactElement) {
  return render(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

afterEach(() => {
  cleanup();
  canvas3d.mockClear();
});

describe("<GameSessionShell> — sala 3D", () => {
  it("el playtest (cliente local) monta el canvas 3D con el pack3d, no el de Phaser", async () => {
    const pack3d = { baseUrl: "/packs/medieval-v1", packId: "medieval-v1" };
    const client = createLocalGameClient(roomPackage, { playerId: "p1" });
    renderIntl(createElement(GameSessionShell, { model, client, pack3d, variant: "playtest" }));

    expect(await screen.findByTestId("canvas-3d")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-2d")).not.toBeInTheDocument();
    expect(canvas3d).toHaveBeenCalledWith(expect.objectContaining({ pack3d }));
  });

  it("una sala 2D monta el canvas de Phaser", async () => {
    const reyAldric = loadRoomPackage(readReyAldricRoomPackageJson());
    const model2d = toRuntimeModel(withLobbyRoom(reyAldric));
    const client = createLocalGameClient(reyAldric, { playerId: "p1" });
    renderIntl(createElement(GameSessionShell, { model: model2d, client, variant: "playtest" }));

    expect(await screen.findByTestId("canvas-2d")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-3d")).not.toBeInTheDocument();
  });
});
