// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRuntimeModel, toPublicRuntimeModel } from "@escaperoom/game-runtime";
import type { GameClient, GameSnapshot } from "@escaperoom/game-runtime/session";
import { act, cleanup, renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import type { GameSessionCanvasHandle } from "../../src/components/game-session/game-session-canvas";
import { useGameHud } from "../../src/components/game-session/hooks/use-game-hud";
import { findRepoRoot } from "../../src/lib/repo-root";

/**
 * Objeto-puente de `simultaneous_plates` / `split_clue` («Usar objeto…» con el
 * busto sobre una placa): el HUD tiene que mandar `useItem` al servidor, no
 * convertirlo en un simple inspeccionar.
 */

const FIXTURES = {
  "2D": "docs/reference/roompackage-rey-aldric.v1.json",
  "3D": "docs/reference/roompackage-rey-aldric-3d.v1.json",
} as const;

function loadModel(dimension: keyof typeof FIXTURES) {
  return toPublicRuntimeModel(
    loadRuntimeModel(readFileSync(join(findRepoRoot(process.cwd()), FIXTURES[dimension]), "utf8")),
  );
}

function makeSnapshot(model: ReturnType<typeof loadModel>): GameSnapshot {
  const self = {
    id: "p1",
    name: "Ana",
    x: 6,
    y: 11,
    h: 0,
    yaw: 0,
    roomId: "salon-trono",
    tint: "#ffffff",
    characterId: "caballero-m",
    connected: true,
    ready: true,
    inMap: true,
    isHost: true,
    isSelf: true,
  };
  return {
    selfId: "p1",
    phase: "playing",
    result: "",
    roomPackageId: model.meta.id,
    roomPackageVersion: "1",
    hostId: "p1",
    organizerControlsStart: false,
    clock: 0,
    startedAt: 0,
    endsAt: 0,
    players: [self],
    self,
    objects: {},
    puzzles: {},
    inventory: ["busto-piedra"],
    inventories: {},
    flags: {},
    chat: [],
  };
}

function makeClient(): GameClient {
  return {
    selfId: "p1",
    getSnapshot: () => undefined as never,
    subscribe: () => () => {},
    onEvent: () => () => {},
    leave: async () => {},
    startGame: vi.fn(),
    setReady: vi.fn(),
    enterMap: vi.fn(),
    kick: vi.fn(),
    move: vi.fn(),
    interact: vi.fn(),
    useItem: vi.fn(),
    combine: vi.fn(),
    openPuzzle: vi.fn(),
    closePuzzle: vi.fn(),
    attempt: vi.fn(),
    setPlate: vi.fn(),
    requestSplitView: vi.fn(),
    requestHint: vi.fn(),
    selectCharacter: vi.fn(),
    sendChat: vi.fn(),
    requestMediaToken: vi.fn(),
  };
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(NextIntlClientProvider, { locale: "es", messages: es, children });

afterEach(() => cleanup());

describe.each(["2D", "3D"] as const)("useGameHud — objeto-puente en el Rey Aldric %s", (dimension) => {
  function setup() {
    const model = loadModel(dimension);
    const client = makeClient();
    const handleRef = { current: null as GameSessionCanvasHandle | null };
    const sceneRoomRef = { current: "salon-trono" as string | undefined };
    const { result } = renderHook(
      () => useGameHud({ model, client, snapshot: makeSnapshot(model), handleRef, sceneRoomRef }),
      { wrapper },
    );
    return { client, result };
  }

  it("«Usar objeto…» con el busto sobre una placa manda useItem (no inspeccionar)", () => {
    const { client, result } = setup();
    act(() => result.current.applyItemUse("busto-piedra", "placa-izq"));
    expect(client.useItem).toHaveBeenCalledWith("busto-piedra", "placa-izq");
    expect(client.interact).not.toHaveBeenCalled();
  });
});
