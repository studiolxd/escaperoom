// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRuntimeModel, toPublicRuntimeModel } from "@escaperoom/game-runtime";
import type { GameClient, GameSnapshot } from "@escaperoom/game-runtime/session";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { SpectatorView } from "../../src/components/event-panel/spectator-game";
import { findRepoRoot } from "../../src/lib/repo-root";
import { readReyAldricRoomPackageJson } from "../../src/lib/room-preview-fixture";

const canvas = vi.hoisted(() => vi.fn());
vi.mock("../../src/components/event-panel/spectator-canvas-3d", () => ({
  default: (props: unknown) => {
    canvas(props);
    return createElement("div", { "data-testid": "spectator-canvas-3d" });
  },
}));

const model3d = toPublicRuntimeModel(
  loadRuntimeModel(
    readFileSync(
      join(findRepoRoot(process.cwd()), "docs/reference/roompackage-demo-3d.v1.json"),
      "utf8",
    ),
  ),
);
const model2d = toPublicRuntimeModel(loadRuntimeModel(readReyAldricRoomPackageJson()));

function makeClient(model: typeof model3d): GameClient {
  const player = (id: string, name: string) => ({
    id,
    name,
    x: 1,
    y: 1,
    h: 0,
    yaw: 0,
    roomId: model.initialRoomId,
    tint: "#ffffff",
    characterId: "caballero-m",
    connected: true,
    ready: true,
    inMap: true,
    isHost: false,
    isSelf: false,
  });
  const snapshot: GameSnapshot = {
    selfId: "",
    phase: "playing",
    result: "",
    roomPackageId: model.meta.id,
    roomPackageVersion: "1",
    hostId: "",
    organizerControlsStart: false,
    clock: 0,
    startedAt: 0,
    endsAt: 0,
    players: [player("p1", "Ana"), player("p2", "Luis")],
    self: null,
    objects: {},
    puzzles: {},
    inventory: [],
    inventories: {},
    flags: {},
    chat: [],
  };
  return {
    selfId: "",
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    onEvent: () => () => {},
  } as unknown as GameClient;
}

function renderView(model: typeof model3d) {
  return render(
    createElement(NextIntlClientProvider, {
      locale: "es",
      messages: es,
      children: createElement(SpectatorView, { client: makeClient(model), model }),
    }),
  );
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  canvas.mockClear();
});

describe("<SpectatorView>", () => {
  it("en una sala 3D muestra el mundo con los selectores de cámara y habitación", async () => {
    renderView(model3d);
    expect(await screen.findByTestId("spectator-canvas-3d")).toBeInTheDocument();
    expect(screen.getByTestId("spectator-camera")).toBeInTheDocument();
    expect(screen.getByTestId("spectator-room")).toBeInTheDocument();
    expect(canvas).toHaveBeenCalledWith(
      expect.objectContaining({ camera: { type: "free" }, players: expect.any(Array) }),
    );
  });

  it("seguir a un jugador cambia la cámara y oculta el selector de habitación", async () => {
    const user = userEvent.setup();
    renderView(model3d);
    await user.click(screen.getByTestId("spectator-camera"));
    await user.click(await screen.findByRole("option", { name: "Seguir a Luis" }));

    expect(canvas).toHaveBeenLastCalledWith(
      expect.objectContaining({ camera: { type: "follow", playerId: "p2" } }),
    );
    expect(screen.queryByTestId("spectator-room")).not.toBeInTheDocument();
  });

  it("en una sala 2D queda exactamente como estaba: sin mundo ni selectores", () => {
    renderView(model2d);
    expect(screen.getByTestId("spectator-view")).toBeInTheDocument();
    expect(screen.queryByTestId("spectator-canvas-3d")).not.toBeInTheDocument();
    expect(screen.queryByTestId("spectator-camera")).not.toBeInTheDocument();
    expect(screen.queryByTestId("spectator-room")).not.toBeInTheDocument();
  });
});
