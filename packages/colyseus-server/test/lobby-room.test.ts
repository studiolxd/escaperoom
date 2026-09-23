import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { ERROR_MESSAGE, LOBBY_ROOM_NAME, MOVE_MESSAGE } from "../src/constants";
import { MOVE_TOO_FAST } from "../src/movement";
import { LobbyTestRoom } from "../src/rooms/lobby-test-room";

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(LOBBY_ROOM_NAME, LobbyTestRoom);
  },
});

beforeAll(async () => {
  colyseus = await boot(config);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("lobby_test (integración con @colyseus/testing)", () => {
  it("sincroniza dos jugadores y refleja un movimiento válido en ambos clientes", async () => {
    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const clientA = await colyseus.connectTo(room);
    expect(room.state.players.size).toBe(1);

    const clientB = await colyseus.connectTo(room);

    expect(room.state.players.size).toBe(2);
    // El patch de sincronización puede llegar en este tick o en el siguiente;
    // esperamos a la convergencia en vez de asumir el primer patch (evita el
    // flake bajo carga cuando turbo corre las tareas en paralelo).
    await expect.poll(() => clientA.state.players.size, { timeout: 5000 }).toBe(2);
    await expect.poll(() => clientB.state.players.size, { timeout: 5000 }).toBe(2);

    const tints = new Set([...room.state.players.values()].map((player) => player.tint));
    expect(tints.size).toBe(2);

    const before = room.state.players.get(clientA.sessionId)!;
    const target = { x: before.x + 0.25, y: before.y + 0.25 };

    clientA.send(MOVE_MESSAGE, target);

    await expect
      .poll(() => room.state.players.get(clientA.sessionId)?.x ?? Number.NaN, { timeout: 5000 })
      .toBeCloseTo(target.x, 2);
    await expect
      .poll(() => clientB.state.players.get(clientA.sessionId)?.x ?? Number.NaN, { timeout: 5000 })
      .toBeCloseTo(target.x, 2);
    await expect
      .poll(() => clientB.state.players.get(clientA.sessionId)?.y ?? Number.NaN, { timeout: 5000 })
      .toBeCloseTo(target.y, 2);
  });

  it("rechaza teletransporte y deja la posición autoritativa intacta", async () => {
    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const clientA = await colyseus.connectTo(room);

    const before = room.state.players.get(clientA.sessionId)!;
    const errorPromise = clientA.waitForMessage(ERROR_MESSAGE);
    clientA.send(MOVE_MESSAGE, { x: 9, y: 9 });
    const error = await errorPromise;

    expect(error.code).toBe(MOVE_TOO_FAST);
    const after = room.state.players.get(clientA.sessionId)!;
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it("elimina al jugador del estado cuando sale", async () => {
    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const clientA = await colyseus.connectTo(room);
    const clientB = await colyseus.connectTo(room);
    expect(room.state.players.size).toBe(2);

    const leavePatch = clientB.waitForNextPatch();
    await clientA.leave();
    await leavePatch;

    expect(room.state.players.size).toBe(1);
    expect(clientB.state.players.size).toBe(1);
    expect(clientB.state.players.has(clientA.sessionId)).toBe(false);
  });
});
