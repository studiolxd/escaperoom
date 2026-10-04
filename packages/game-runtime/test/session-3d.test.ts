import { describe, expect, it } from "vitest";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import {
  createLocalGameClient,
  createNetworkGameClient,
  GAME_MAX_STEP_3D_M,
  toGameSnapshot,
  type GameEvent,
  type GameRoomConnection,
  type GameRoomStateLike,
} from "../src/session";

/**
 * Modo 3D en la capa de sesión (encargo 7.4): `h` y `yaw` en la instantánea,
 * en el mensaje `move` y en el cliente local del playtest.
 */

function each<T>(record: Record<string, T>) {
  return {
    forEach: (callback: (value: T, key: string) => void) => {
      for (const [key, value] of Object.entries(record)) callback(value, key);
    },
  };
}

type PlayerState = NonNullable<GameRoomStateLike["players"]> extends { forEach: (cb: (v: infer P) => void) => void }
  ? P
  : never;

function stateWith(player: Partial<PlayerState>): GameRoomStateLike {
  return {
    phase: "playing",
    result: "",
    roomPackageId: "sala",
    roomPackageVersion: "1.0.0",
    startedAt: 0,
    endsAt: 0,
    clock: 0,
    hostId: "a",
    organizerControlsStart: false,
    players: each({
      a: {
        id: "a",
        name: "Ana",
        x: 1,
        y: 2,
        roomId: "sala",
        tint: "#38bdf8",
        characterId: "caballero-m",
        connected: true,
        ready: true,
        ...player,
      },
    }),
    objects: each({}),
    puzzles: each({}),
    inventories: each({}),
    flags: each({}),
    chat: [],
  } as GameRoomStateLike;
}

describe("toGameSnapshot en 3D", () => {
  it("proyecta h y yaw del estado", () => {
    const snapshot = toGameSnapshot(stateWith({ h: 0.4, yaw: 135 }), "a");
    expect(snapshot.self).toMatchObject({ h: 0.4, yaw: 135 });
  });

  it("vale 0 si el estado no los trae (rooms anteriores)", () => {
    const snapshot = toGameSnapshot(stateWith({}), "a");
    expect(snapshot.self).toMatchObject({ h: 0, yaw: 0 });
  });

  it("un cambio de h o yaw invalida la entrada del jugador", () => {
    const first = toGameSnapshot(stateWith({ h: 0, yaw: 0 }), "a");
    const same = toGameSnapshot(stateWith({ h: 0, yaw: 0 }), "a", first);
    expect(same.self).toBe(first.self);
    const turned = toGameSnapshot(stateWith({ h: 0, yaw: 90 }), "a", first);
    expect(turned.self).not.toBe(first.self);
    expect(turned.self?.yaw).toBe(90);
  });
});

describe("createNetworkGameClient: move", () => {
  function connect() {
    const sent: Array<{ type: string; payload: unknown }> = [];
    const room: GameRoomConnection = {
      sessionId: "a",
      state: stateWith({}),
      send: (type, payload) => sent.push({ type, payload }),
      onStateChange: Object.assign(() => undefined, { remove: () => undefined }),
      onMessage: () => () => undefined,
      leave: () => Promise.resolve(),
    };
    return { client: createNetworkGameClient(room), sent };
  }

  it("envía h y yaw solo si vienen en `extra`", () => {
    const { client, sent } = connect();
    client.move(1, 2);
    client.move(1, 2, undefined, { h: 0.5, yaw: 90 });
    client.move(1, 2, "sala-b");
    client.move(1, 2, undefined, { yaw: 10 });
    expect(sent.map((entry) => entry.payload)).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 2, h: 0.5, yaw: 90 },
      { x: 1, y: 2, roomId: "sala-b" },
      { x: 1, y: 2, yaw: 10 },
    ]);
  });
});

describe("protocolo 3D", () => {
  it("el salto máximo 3D es de 1,5 m", () => {
    expect(GAME_MAX_STEP_3D_M).toBe(1.5);
  });
});

function room3D() {
  const floor = (id: string, x: number, y: number) => ({
    id: `p-${id}`.padEnd(10, "0"),
    model: "suelo-test",
    x,
    y,
    h: 0,
    yaw: 0,
  });
  return parseRoomPackage({
    meta: {
      id: "sala-3d-local",
      title: "Sala 3D local",
      authorId: "autora",
      version: "1.0.0",
      packageFormat: "roompackage/v1",
      theme: "medieval",
      description: "Sala de prueba del cliente local 3D",
      languages: ["es"],
      defaultLanguage: "es",
      estimatedMinutes: 2,
      timeLimitMinutes: 10,
      difficulty: 1,
      players: { min: 1, max: 1 },
      assetsManifest: "r2://assets/packs/medieval-v1/manifest.json",
      dimension: "3d",
    },
    map: {
      tileset: "medieval-v1",
      rooms: [
        {
          id: "sala",
          name: "Sala",
          grid: { cols: 12, rows: 12 },
          layers: [],
          decorations: [],
          spawnPoints: [{ id: "spawn-1", x: 1, y: 1, h: 0, yaw: 90 }],
          lighting: [{ type: "ambient", color: "#ffffff", intensity: 1 }],
        },
      ],
    },
    objects: [],
    items: [],
    puzzles: [],
    rules: [],
    dialogs: [],
    hints: [],
    world3d: {
      rooms: { sala: { pieces: [floor("a", 0.5, 0.5)] } },
      models: {
        "suelo-test": {
          ref: "suelo-test",
          label: "Suelo",
          size: { w: 1, d: 1, hgt: 0.1 },
          colliders: [{ type: "box", cx: 0, cy: 0, ch: -0.05, sx: 1, sy: 1, sh: 0.1 }],
          clips: [],
        },
      },
    },
  });
}

describe("createLocalGameClient en una sala 3D", () => {
  function setup() {
    const client = createLocalGameClient(room3D(), { tickMs: false, now: () => 0 });
    const events: GameEvent[] = [];
    client.onEvent((event) => events.push(event));
    client.startGame(true);
    client.enterMap();
    return { client, events };
  }

  it("el jugador aparece con la h y el yaw del spawn", () => {
    const { client } = setup();
    expect(client.getSnapshot().self).toMatchObject({ roomId: "sala", x: 1, y: 1, h: 0, yaw: 90 });
  });

  it("acepta el movimiento sin navmesh y guarda h y yaw", () => {
    const { client, events } = setup();
    // Más lejos que el salto máximo de 1,5 m y fuera de cualquier suelo: no se valida.
    client.move(9, 7, undefined, { h: 0.3, yaw: 45 });
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(client.getSnapshot().self).toMatchObject({ x: 9, y: 7, h: 0.3, yaw: 45 });
  });

  it("sin `extra` conserva la h y el yaw anteriores", () => {
    const { client } = setup();
    client.move(2, 2, undefined, { h: 0.2, yaw: 270 });
    client.move(3, 2);
    expect(client.getSnapshot().self).toMatchObject({ x: 3, y: 2, h: 0.2, yaw: 270 });
  });

  it("rechaza valores no finitos", () => {
    const { client, events } = setup();
    client.move(Number.NaN, 2);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "OUT_OF_BOUNDS" });
  });
});
