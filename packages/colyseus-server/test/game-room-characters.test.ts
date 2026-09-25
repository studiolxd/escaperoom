import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { ERROR_MESSAGE, GAME_ERRORS, GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import { resetAvatarPackCache } from "../src/game/avatar-pack";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";

/**
 * Personajes seleccionables (A1/B4): asignación al unirse, unicidad por
 * sesión (resuelve la carrera de dos que eligen a la vez) y cambio explícito
 * vía `select_character`. Corre contra el manifiesto real de `medieval-v1`
 * (`pnpm pack:build medieval-v1`): hoy solo declara `caballero-m`, así que a
 * partir del segundo jugador cae al maniquí de reserva.
 */

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
  },
});

beforeAll(async () => {
  colyseus = await boot(config, await getFreePort());
});

beforeEach(() => {
  resetAvatarPackCache();
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function join(room: GameRoom, options: object = {}) {
  return colyseus.connectTo(room, options);
}

describe("personajes seleccionables (GameRoom)", () => {
  it("asigna el primer personaje libre al unirse sin elegir", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const a = await join(room, { name: "Ana" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("caballero-m");
  });

  it("cae al maniquí de reserva cuando no queda ningún personaje libre", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("caballero-m");
    expect(room.state.players.get(b.sessionId)?.characterId).toBe("maniqui");
  });

  it("respeta el characterId pedido al unirse si está libre", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const a = await join(room, { name: "Ana", characterId: "caballero-m" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("caballero-m");
  });

  it("resuelve la carrera de dos que piden el mismo personaje al unirse", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const a = await join(room, { name: "Ana", characterId: "caballero-m" });
    // Colyseus procesa `onJoin` en orden: el segundo pedido del mismo personaje
    // cae al maniquí en vez de duplicarlo.
    const b = await join(room, { name: "Bruno", characterId: "caballero-m" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("caballero-m");
    expect(room.state.players.get(b.sessionId)?.characterId).toBe("maniqui");
  });

  it("rechaza un characterId que no existe en el pack", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const a = await join(room, { name: "Ana", characterId: "brujo-x" });
    // Inválido: el servidor ignora el pedido y asigna el primero libre.
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("caballero-m");
  });

  it("select_character cambia el personaje si está libre", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const a = await join(room, { name: "Ana" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("caballero-m");

    // Sin nadie más en la sala, puede soltar el caballero y volver a él.
    a.send(GAME_MESSAGES.selectCharacter, { characterId: "maniqui" });
    await expect.poll(() => room.state.players.get(a.sessionId)?.characterId).toBe("maniqui");

    a.send(GAME_MESSAGES.selectCharacter, { characterId: "caballero-m" });
    await expect
      .poll(() => room.state.players.get(a.sessionId)?.characterId)
      .toBe("caballero-m");
  });

  it("select_character rechaza un personaje ya ocupado por otro jugador", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("caballero-m");

    const rejection = b.waitForMessage(ERROR_MESSAGE);
    b.send(GAME_MESSAGES.selectCharacter, { characterId: "caballero-m" });
    expect((await rejection).code).toBe(GAME_ERRORS.notAvailable);
    expect(room.state.players.get(b.sessionId)?.characterId).toBe("maniqui");
  });
});
