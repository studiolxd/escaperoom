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
import { useSceneSync } from "../../src/components/game-session/hooks/use-scene-sync";
import { findRepoRoot } from "../../src/lib/repo-root";

const model = toPublicRuntimeModel(
  loadRuntimeModel(
    readFileSync(
      join(findRepoRoot(process.cwd()), "docs/reference/roompackage-demo-3d.v1.json"),
      "utf8",
    ),
  ),
);

function makeSnapshot(overrides: Partial<GameSnapshot> = {}, roomId = "antesala"): GameSnapshot {
  const self = {
    id: "p1",
    name: "Ana",
    x: 2.25,
    y: 3.5,
    h: 0.4,
    yaw: 90,
    roomId,
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
    inventory: [],
    inventories: {},
    flags: {},
    chat: [],
    ...overrides,
  };
}

function makeClient(): GameClient {
  return {
    selfId: "p1",
    getSnapshot: () => makeSnapshot(),
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

function makeHandle(): GameSessionCanvasHandle {
  return {
    showRoom: vi.fn(),
    placeAvatar: vi.fn(),
    avatarCell: vi.fn(() => undefined),
    setObjectState: vi.fn(),
    setPlayers: vi.fn(),
    setLocalTint: vi.fn(),
    setLocalCharacter: vi.fn(),
    getObjectScreenFraction: vi.fn(),
    isObjectInteractive: vi.fn(() => true),
    walkTo: vi.fn(() => true),
  };
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(NextIntlClientProvider, { locale: "es", messages: es, children });

afterEach(() => cleanup());

describe("useSceneSync — sala 3D", () => {
  it("coloca el avatar con la altura y el giro del servidor", () => {
    const handle = makeHandle();
    const { result, rerender } = renderHook(
      ({ snapshot }) => useSceneSync(model, snapshot),
      { initialProps: { snapshot: makeSnapshot() } },
    );
    act(() => result.current.onReady(handle));
    expect(handle.placeAvatar).toHaveBeenCalledWith(2.25, 3.5, 0.4, 90);

    // Cruce a otra sala: el servidor manda la posición nueva (con h y yaw).
    const crossed = makeSnapshot({}, "camara");
    crossed.self = { ...crossed.self!, x: 1, y: 2, h: 1.2, yaw: 180 };
    rerender({ snapshot: crossed });
    expect(handle.showRoom).toHaveBeenCalledWith("camara", expect.any(Function));
    expect(handle.placeAvatar).toHaveBeenLastCalledWith(1, 2, 1.2, 180);
  });
});

describe("useGameHud — sala 3D", () => {
  function setup(snapshot = makeSnapshot()) {
    const client = makeClient();
    const handle = makeHandle();
    const handleRef = { current: handle as GameSessionCanvasHandle | null };
    const sceneRoomRef = { current: "antesala" as string | undefined };
    const { result } = renderHook(
      () => useGameHud({ model, client, snapshot, handleRef, sceneRoomRef }),
      { wrapper },
    );
    return { client, handle, result };
  }

  it("avatar-move manda h y yaw al servidor", () => {
    const { client, result } = setup();
    act(() =>
      result.current.onWorldEvent({
        type: "avatar-move",
        roomId: "antesala",
        x: 3,
        y: 4,
        h: 0.4,
        yaw: 45,
      }),
    );
    expect(client.move).toHaveBeenCalledWith(3, 4, undefined, { h: 0.4, yaw: 45 });
  });

  it("interactuar con una puerta abierta camina a su transform y, al llegar, cruza", () => {
    const { client, handle, result } = setup(makeSnapshot({ objects: { puerta: "open" } }));
    act(() => result.current.onWorldEvent({ type: "interact", objectId: "puerta" }));

    const door = model.objectsById["puerta"]!;
    expect(door.transform).toBeDefined();
    expect(handle.walkTo).toHaveBeenCalledTimes(1);
    const [target, onArrive] = vi.mocked(handle.walkTo!).mock.calls[0]!;
    expect(target).toEqual(door.transform);
    expect(client.move).not.toHaveBeenCalled();

    act(() => onArrive?.());
    expect(client.move).toHaveBeenCalledWith(0, 0, door.leadsTo);
  });

  it("el diálogo de inspección abierto bloquea el movimiento y, al cerrarlo, vuelve", () => {
    const { result } = setup();
    expect(result.current.worldInputEnabled).toBe(true);
    act(() => result.current.setDialog({ id: "d-brasero", text: "Un brasero." }));
    expect(result.current.worldInputEnabled).toBe(false);
    act(() => result.current.setDialog(null));
    expect(result.current.worldInputEnabled).toBe(true);
  });

  it("la imagen grande abierta bloquea el movimiento y, al cerrarla, vuelve", () => {
    const { result } = setup();
    act(() => result.current.setImagePanel({ image: "carta", caption: "Una carta." }));
    expect(result.current.worldInputEnabled).toBe(false);
    act(() => result.current.setImagePanel(null));
    expect(result.current.worldInputEnabled).toBe(true);
  });
});
