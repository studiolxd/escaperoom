import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import type { Models3DCatalog } from "@escaperoom/shared/packs";
import { parseRoomPackage, type Collider3D, type RoomPackage } from "@escaperoom/shared/schemas";
import { ERROR_MESSAGE, GAME_ERRORS, GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * Movimiento 3D en la `GameRoom` (encargo 7.4): `move` validado contra la
 * navmesh de la habitación, `h`/`yaw` en el estado y cruce de habitación con
 * altura. La sala 2D (Rey Aldric) sigue moviéndose como antes.
 */

type Entry = Models3DCatalog["models"][string];

function entry(size: { w: number; d: number; hgt: number }, colliders: Collider3D[]): Entry {
  return {
    file: "models/x.glb",
    category: "suelto",
    label: { es: { text: "x" } },
    size,
    colliders,
    snap: false,
    clips: [],
  };
}

/** Catálogo de prueba inyectado: suelo de 1 × 1 (cara superior a h = 0) y muro de 1 × 1 × 2,4. */
const TEST_CATALOG: Models3DCatalog = {
  packId: "test-v1",
  version: "1",
  avatars: {},
  models: {
    suelo: entry({ w: 1, d: 1, hgt: 0.1 }, [
      { type: "box", cx: 0, cy: 0, ch: -0.05, sx: 1, sy: 1, sh: 0.1 },
    ]),
    muro: entry({ w: 1, d: 1, hgt: 2.4 }, [
      { type: "box", cx: 0, cy: 0, ch: 1.2, sx: 1, sy: 1, sh: 2.4 },
    ]),
  },
};

function floorPieces(prefix: string) {
  const pieces = [];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      pieces.push({
        id: `p-${prefix}${i}${j}`.padEnd(10, "0"),
        model: "suelo",
        x: i + 0.5,
        y: j + 0.5,
        h: 0,
        yaw: 0,
      });
    }
  }
  return pieces;
}

const closed = { sprite: "puerta-test" } as const;

/**
 * Dos habitaciones de 6 × 6 m. En `sala-a`: un muro (x = 3..4, y = 0..3), una
 * puerta abierta a `sala-b` en (5,5, 3) y una placa en (1, 5).
 */
function package3D(): RoomPackage {
  return parseRoomPackage({
    meta: {
      id: "sala-3d-servidor",
      title: "Sala 3D del servidor",
      authorId: "autora",
      version: "1.0.0",
      packageFormat: "roompackage/v1",
      theme: "medieval",
      description: "Sala de prueba del movimiento 3D",
      languages: ["es"],
      defaultLanguage: "es",
      estimatedMinutes: 2,
      timeLimitMinutes: 10,
      difficulty: 1,
      players: { min: 1, max: 2 },
      assetsManifest: "r2://assets/packs/medieval-v1/manifest.json",
      dimension: "3d",
    },
    map: {
      tileset: "medieval-v1",
      rooms: [
        {
          id: "sala-a",
          name: "Sala A",
          grid: { cols: 6, rows: 6 },
          layers: [],
          decorations: [],
          spawnPoints: [{ id: "spawn-a", x: 1, y: 1, h: 0, yaw: 90 }],
          lighting: [{ type: "ambient", color: "#ffffff", intensity: 1 }],
        },
        {
          id: "sala-b",
          name: "Sala B",
          grid: { cols: 6, rows: 6 },
          layers: [],
          decorations: [],
          spawnPoints: [{ id: "spawn-b", x: 2, y: 2, h: 0.2, yaw: 180 }],
          lighting: [{ type: "ambient", color: "#ffffff", intensity: 1 }],
        },
      ],
    },
    objects: [
      {
        id: "puerta-ab",
        roomId: "sala-a",
        type: "puerta",
        position: { x: 6, y: 3 },
        transform: { x: 5.5, y: 3, h: 0, yaw: 90 },
        sprite: "puerta-test",
        states: { closed: closed.sprite, open: closed.sprite },
        initialState: "open",
        interactable: false,
        leadsTo: "sala-b",
      },
      {
        id: "placa-1",
        roomId: "sala-a",
        type: "placa",
        position: { x: 1, y: 5 },
        transform: { x: 1, y: 5, h: 0, yaw: 0 },
        sprite: "muro",
        states: { idle: "muro" },
        initialState: "idle",
        interactable: false,
      },
    ],
    items: [],
    puzzles: [
      {
        id: "placas",
        type: "simultaneous_plates",
        layer: "world",
        roomId: "sala-a",
        requiresSolved: [],
        grantsItems: [],
        unlocks: [],
        plates: [{ objectId: "placa-1", x: 1, y: 5 }],
        windowMs: 1000,
        holdMode: "stand",
      },
    ],
    rules: [],
    dialogs: [],
    hints: [],
    world3d: {
      rooms: {
        "sala-a": {
          pieces: [
            ...floorPieces("a"),
            ...[0, 1, 2].map((j) => ({
              id: `p-muro000${j}`,
              model: "muro",
              x: 3.5,
              y: j + 0.5,
              h: 0,
              yaw: 0,
            })),
          ],
        },
        "sala-b": { pieces: floorPieces("b") },
      },
      models: {},
    },
  });
}

class Room3D extends GameRoom {
  protected override loadRoomPackage(): RoomPackage {
    return package3D();
  }
  protected override models3DCatalog(): Models3DCatalog {
    return TEST_CATALOG;
  }
}

const ROOM_3D_NAME = "game_3d_test";

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(ROOM_3D_NAME, Room3D);
    server.define(GAME_ROOM_NAME, GameRoom);
  },
});

beforeAll(async () => {
  colyseus = await boot(config, await getFreePort());
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

/** Crea una sala, conecta un jugador y lo mete en el mapa (fase `playing`). */
async function startGame(roomName: string) {
  const room = await colyseus.createRoom<GameRoom>(roomName, { gameToken: devTestGameToken() });
  const client = await colyseus.connectTo(room, { gameToken: devTestGameToken(), name: "Ana" });
  client.send(GAME_MESSAGES.setReady, { ready: true });
  await expect.poll(() => room.state.players.get(client.sessionId)?.ready).toBe(true);
  client.send(GAME_MESSAGES.startGame, {});
  await expect.poll(() => client.state.phase).toBe("starting");
  client.send(GAME_MESSAGES.enterMap, {});
  await expect.poll(() => client.state.phase).toBe("playing");
  await expect.poll(() => room.state.players.get(client.sessionId)?.inMap).toBe(true);
  return { room, client };
}

type Started = Awaited<ReturnType<typeof startGame>>;

const playerOf = ({ room, client }: Started) => room.state.players.get(client.sessionId)!;

/** Pasos de ≤ 1,5 m (el máximo por mensaje), uno cada 120 ms (límite de 10 `move`/s). */
async function stepTo(
  game: Started,
  to: { x: number; y: number; h?: number; yaw?: number },
): Promise<void> {
  game.client.send(GAME_MESSAGES.move, to);
  await expect
    .poll(() => Math.hypot(playerOf(game).x - to.x, playerOf(game).y - to.y))
    .toBeLessThan(0.01);
  await new Promise((resolve) => setTimeout(resolve, 120));
}

describe("GameRoom 3D", () => {
  it("un `move` válido actualiza x, y, h y yaw del estado", async () => {
    const game = await startGame(ROOM_3D_NAME);
    const player = playerOf(game);
    expect(player.roomId).toBe("sala-a");
    expect(player.yaw).toBe(90);

    game.client.send(GAME_MESSAGES.move, { x: 2, y: 1.5, h: 0, yaw: 45 });
    await expect.poll(() => player.x).toBeCloseTo(2, 1);
    expect(player.y).toBeCloseTo(1.5, 1);
    // La navmesh guarda su altura, no la pedida (recast la cuantiza en celdas de 0,1 m).
    expect(player.h).toBeGreaterThanOrEqual(-0.05);
    expect(player.h).toBeLessThanOrEqual(0.2);
    expect(player.yaw).toBe(45);
  });

  it("un `move` sin yaw conserva el giro anterior", async () => {
    const game = await startGame(ROOM_3D_NAME);
    await stepTo(game, { x: 1.5, y: 1, h: 0, yaw: 270 });
    await stepTo(game, { x: 2, y: 1, h: 0 });
    expect(playerOf(game).yaw).toBe(270);
  });

  it("un `move` dentro de un muro devuelve OUT_OF_BOUNDS", async () => {
    const game = await startGame(ROOM_3D_NAME);
    await stepTo(game, { x: 2, y: 1, h: 0 });

    const rejected = game.client.waitForMessage(ERROR_MESSAGE);
    game.client.send(GAME_MESSAGES.move, { x: 3.5, y: 1, h: 0 });
    expect((await rejected).code).toBe("OUT_OF_BOUNDS");
    expect(playerOf(game).x).toBeCloseTo(2, 1);
  });

  it("un `move` de 3 m devuelve MOVE_TOO_FAST", async () => {
    const game = await startGame(ROOM_3D_NAME);
    const rejected = game.client.waitForMessage(ERROR_MESSAGE);
    game.client.send(GAME_MESSAGES.move, { x: 1, y: 4, h: 0 });
    expect((await rejected).code).toBe(GAME_ERRORS.moveTooFast);
    expect(playerOf(game).y).toBeCloseTo(1, 1);
  });

  it("la placa no bloquea: se puede pisar su celda", async () => {
    const game = await startGame(ROOM_3D_NAME);
    for (const [x, y] of [
      [1, 2.4],
      [1, 3.8],
      [1, 5],
    ] as const) {
      await stepTo(game, { x, y, h: 0 });
    }
    expect(playerOf(game).y).toBeCloseTo(5, 1);
  });

  it("lejos de la puerta, el cruce devuelve ROOM_LOCKED", async () => {
    const game = await startGame(ROOM_3D_NAME);
    const locked = game.client.waitForMessage(ERROR_MESSAGE);
    game.client.send(GAME_MESSAGES.move, { x: 0, y: 0, roomId: "sala-b" });
    expect((await locked).code).toBe(GAME_ERRORS.roomLocked);
    expect(playerOf(game).roomId).toBe("sala-a");
  });

  it("cerca de la puerta, el jugador aparece en el spawn destino con su h y yaw", async () => {
    const game = await startGame(ROOM_3D_NAME);
    // Rodea el muro (x = 3..4, y = 0..3) por el sur hasta la puerta de (5,5, 3).
    for (const [x, y] of [
      [2, 2],
      [2, 3.4],
      [3.2, 4],
      [4.4, 4],
      [5, 3.6],
    ] as const) {
      await stepTo(game, { x, y, h: 0 });
    }

    game.client.send(GAME_MESSAGES.move, { x: 0, y: 0, roomId: "sala-b" });
    const player = playerOf(game);
    await expect.poll(() => player.roomId).toBe("sala-b");
    expect(player.x).toBe(2);
    expect(player.y).toBe(2);
    expect(player.h).toBeCloseTo(0.2, 5);
    expect(player.yaw).toBe(180);
  });
});

describe("GameRoom 2D", () => {
  it("el Rey Aldric se mueve como antes y su estado lleva h = 0 y yaw = 0", async () => {
    const game = await startGame(GAME_ROOM_NAME);
    const player = playerOf(game);
    expect(player.h).toBe(0);
    expect(player.yaw).toBe(0);

    const from = { x: player.x, y: player.y };
    // Un `h`/`yaw` en una sala 2D se ignora.
    game.client.send(GAME_MESSAGES.move, { x: from.x + 1, y: from.y, h: 2, yaw: 90 });
    await expect.poll(() => player.x).toBeCloseTo(from.x + 1, 5);
    expect(player.y).toBe(from.y);
    expect(player.h).toBe(0);
    expect(player.yaw).toBe(0);
  });
});
