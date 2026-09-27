import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import {
  createInMemoryGameAccessStore,
  type InMemoryGameAccessPurchase,
} from "@escaperoom/shared/game-access";
import {
  signGameAccessToken,
  readGameAccessTokenConfig,
} from "@escaperoom/shared/game-access-token";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { ERROR_MESSAGE, GAME_ERRORS, GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import { configureGameAccessRuntime } from "../src/game/access-runtime";
import { resetAvatarPackCache } from "../src/game/avatar-pack";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * Personajes seleccionables (A1/B4): asignación al unirse, unicidad por
 * sesión (resuelve la carrera de dos que eligen a la vez) y cambio explícito
 * vía `select_character`. Corre contra el manifiesto real de `medieval-v1`
 * (`pnpm pack:build medieval-v1`): hoy declara 8 personajes (reparto de
 * `docs/personajes.md`; los 7 que no son `caballero-m` son alias
 * provisionales de sus mismos frames, ver `docs/DEUDA.md`), en orden
 * alfabético de id (`arquero-f` el primero). El maniquí de reserva entra
 * cuando el personaje pedido no está libre y no queda ningún otro; con los
 * 8 ya asignados no cabe un noveno jugador real (`MAX_PLAYERS` es también 8),
 * así que ese extremo se prueba a nivel de función en `characters.test.ts`.
 */
const ALL_CHARACTER_IDS = [
  "arquero-f",
  "arquero-m",
  "caballero-f",
  "caballero-m",
  "campesina-f",
  "campesino-m",
  "mago-f",
  "mago-m",
];

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
  configureGameAccessRuntime(undefined);
});

afterAll(async () => {
  await colyseus.shutdown();
});

function createGameRoom() {
  return colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { gameToken: devTestGameToken() });
}

function join(room: GameRoom, options: object = {}) {
  return colyseus.connectTo(room, { gameToken: devTestGameToken(), ...options });
}

let roomVersionCounter = 0;

/**
 * Sala a medida con `meta.players.max` ampliado a los 8 personajes (el
 * fixture del Rey Aldric admite solo 4, ver `game-room-lobby.test.ts`):
 * hace falta para probar que el maniquí de reserva solo entra cuando los 8
 * personajes ya están ocupados.
 */
async function createGameRoomWithMaxPlayers(max: number) {
  roomVersionCounter += 1;
  const roomVersionId = `88888888-8888-8888-8888-88888888888${roomVersionCounter}`;
  const fixture = loadReyAldricRoomPackage();
  const roomPackage = parseRoomPackage({
    ...fixture,
    meta: { ...fixture.meta, id: "sala-max-personajes", title: "Sala max", players: { min: 1, max } },
  } as unknown);
  const store = createInMemoryGameAccessStore({
    packages: { [roomVersionId]: roomPackage },
    purchases: [
      {
        id: `purchase-${roomVersionId}`,
        playSessionStartedAt: null,
        playSessionEndedAt: null,
        playSessionColyseusId: null,
        playSessionHeartbeatAt: null,
      } satisfies InMemoryGameAccessPurchase,
    ],
  });
  configureGameAccessRuntime(store);
  const gameAccessConfig = readGameAccessTokenConfig()!;
  const now = Date.now();
  const token = signGameAccessToken(
    gameAccessConfig.secret,
    {
      kind: "purchase",
      purchaseId: `purchase-${roomVersionId}`,
      userId: "user:ana",
      roomVersionId,
    },
    { now, expiresAt: now + 15 * 60 * 1000 },
  );
  const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, { gameToken: token });
  return { room, gameToken: token };
}

describe("personajes seleccionables (GameRoom)", () => {
  it("asigna el primer personaje libre al unirse sin elegir", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("arquero-f");
  });

  // `MAX_PLAYERS` (`../src/constants.ts`) es 8, igual que el nº de personajes seleccionables hoy: una sala real
  // nunca llega a tener los 8 ocupados y sitio para un jugador más (el maniquí de reserva ocuparía un noveno
  // puesto que no existe). Ese caso límite ("no queda ningún personaje libre") se prueba a nivel de función en
  // `characters.test.ts` (`pickPlayerCharacter`), sin el límite de aforo de una `GameRoom` real; aquí se
  // comprueba el extremo que sí es alcanzable: los 8 se asignan sin duplicados.
  it("asigna un personaje distinto a cada uno de los 8 jugadores de una sala llena", async () => {
    const { room, gameToken } = await createGameRoomWithMaxPlayers(8);
    const players = [];
    for (const [i, characterId] of ALL_CHARACTER_IDS.entries()) {
      players.push(await colyseus.connectTo(room, { gameToken, name: `Jugador ${i}`, characterId }));
    }
    const assigned = players.map((p) => room.state.players.get(p.sessionId)?.characterId);
    expect(new Set(assigned)).toEqual(new Set(ALL_CHARACTER_IDS));
  });

  it("respeta el characterId pedido al unirse si está libre", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana", characterId: "caballero-m" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("caballero-m");
  });

  it("resuelve la carrera de dos que piden el mismo personaje al unirse", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana", characterId: "caballero-m" });
    // Colyseus procesa `onJoin` en orden: el segundo pedido del mismo personaje
    // cae al primero libre (quedan otros 7), no lo duplica.
    const b = await join(room, { name: "Bruno", characterId: "caballero-m" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("caballero-m");
    expect(room.state.players.get(b.sessionId)?.characterId).toBe("arquero-f");
  });

  it("rechaza un characterId que no existe en el pack", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana", characterId: "brujo-x" });
    // Inválido: el servidor ignora el pedido y asigna el primero libre.
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("arquero-f");
  });

  it("select_character cambia el personaje si está libre", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    expect(room.state.players.get(a.sessionId)?.characterId).toBe("arquero-f");

    // Sin nadie más en la sala, puede soltar el personaje y volver a él.
    a.send(GAME_MESSAGES.selectCharacter, { characterId: "maniqui" });
    await expect.poll(() => room.state.players.get(a.sessionId)?.characterId).toBe("maniqui");

    a.send(GAME_MESSAGES.selectCharacter, { characterId: "arquero-f" });
    await expect
      .poll(() => room.state.players.get(a.sessionId)?.characterId)
      .toBe("arquero-f");
  });

  it("select_character rechaza un personaje ya ocupado por otro jugador", async () => {
    const room = await createGameRoom();
    const a = await join(room, { name: "Ana" });
    const b = await join(room, { name: "Bruno" });
    const takenByA = room.state.players.get(a.sessionId)?.characterId;
    expect(takenByA).toBe("arquero-f");
    const takenByB = room.state.players.get(b.sessionId)?.characterId;
    expect(takenByB).toBe("arquero-m");

    const rejection = b.waitForMessage(ERROR_MESSAGE);
    b.send(GAME_MESSAGES.selectCharacter, { characterId: takenByA });
    expect((await rejection).code).toBe(GAME_ERRORS.notAvailable);
    // El rechazo no le quita a Bruno el suyo.
    expect(room.state.players.get(b.sessionId)?.characterId).toBe(takenByB);
  });
});
