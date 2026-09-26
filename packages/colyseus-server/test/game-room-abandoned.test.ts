import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import {
  createInMemoryGameAccessStore,
  type InMemoryGameAccessPurchase,
} from "@escaperoom/shared/game-access";
import {
  readGameAccessTokenConfig,
  signGameAccessToken,
} from "@escaperoom/shared/game-access-token";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import { GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import { configureGameAccessRuntime } from "../src/game/access-runtime";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";
import { devTestGameToken } from "./helpers/game-token";

/**
 * Partidas abandonadas (decisión del usuario 2026-09-26, specs/11 §8.2,
 * ADR-043): en juego (`starting`/`playing`) la plaza se reserva
 * indefinidamente al desconectar (C-2), así que sin duración (ADR-038/#169)
 * nada cerraba la room si TODOS se iban. Igual que
 * `game-room-reconnection.test.ts`, los plazos reales (1 h) son demasiado
 * lentos para un test: `FastAbandonedRoom` los acorta con los mismos puntos
 * de extensión que usará producción.
 *
 * Determinismo bajo CI cargado (revisión de la coordinadora, PR #183): nada
 * de "duerme X ms y comprueba una vez" para una condición que puede haber
 * ocurrido ya (o no haber ocurrido todavía) — `expect.poll` con un timeout
 * generoso en su lugar, y sin ninguna aserción SÍNCRONA justo después de un
 * `await` que ya pudo tardar más que el propio plazo que se quiere probar
 * que aún no se cumplió. El único sitio donde "esperar tiempo real y
 * comprobar una vez" sigue siendo razonable es demostrar un NEGATIVO ("no se
 * cerró"): ahí el margen es amplio a propósito (varias veces el plazo) para
 * que una máquina lenta nunca lo convierta en un falso fallo — solo podría
 * debilitar la prueba, nunca romperla.
 */

const FAST_SECONDS = 0.15;
const FAST_ROOM_NAME = "game_abandoned_test";
/**
 * Ventana de abandono más generosa, solo para el test que reconecta antes del
 * plazo: ese test necesita completar `leave` + `reconnect` DENTRO de la
 * ventana para probar algo (que cancela la cuenta atrás) — con
 * `FAST_SECONDS` (150 ms) unos pocos cientos de ms de jitter de un runner
 * cargado (confirmado en local con carga de CPU artificial) ya bastan para
 * que la cuenta atrás cumpla ANTES de que `reconnect` llegue a intentarlo, lo
 * que rompería la premisa del test (no es un fallo del código, es que el
 * test ya no puede demostrar lo que quiere demostrar). Los demás tests solo
 * esperan el DESENLACE final (`expect.poll` sin límite de tiempo ajustado),
 * así que para ellos `FAST_SECONDS` sigue siendo lo correcto: más corto que
 * `TEST_TIMEOUT_MS`, y cuanto antes ocurra, antes se resuelve el poll.
 */
const ABANDON_RACE_SECONDS = 2;
const RACE_ROOM_NAME = "game_abandoned_race_test";
/** Timeout de test generoso: cada uno hace varias rondas de red reales + al
 * menos un plazo de `FAST_SECONDS`/`ABANDON_RACE_SECONDS`; con CI cargado, el
 * timeout por defecto de vitest (5000 ms) es demasiado ajustado
 * (docs/reference/verify-pr.md, "Timeouts de CI"). */
const TEST_TIMEOUT_MS = 20_000;

class FastAbandonedRoom extends GameRoom {
  protected override lobbyReconnectGraceSeconds(): number {
    return FAST_SECONDS;
  }
  protected override hostReassignGraceSeconds(): number {
    return FAST_SECONDS;
  }
  protected override resultsRoomLifetimeSeconds(): number {
    return FAST_SECONDS;
  }
  protected override abandonedGameTimeoutSeconds(): number {
    return FAST_SECONDS;
  }
}

class RaceAbandonedRoom extends FastAbandonedRoom {
  protected override abandonedGameTimeoutSeconds(): number {
    return ABANDON_RACE_SECONDS;
  }
}

let colyseus: ColyseusTestServer;
const ROOM_VERSION_ID = "55555555-5555-5555-5555-555555555555";

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
    server.define(FAST_ROOM_NAME, FastAbandonedRoom);
    server.define(RACE_ROOM_NAME, RaceAbandonedRoom);
  },
});

beforeAll(async () => {
  colyseus = await boot(config, await getFreePort());
});

afterEach(async () => {
  await colyseus.cleanup();
  configureGameAccessRuntime(undefined);
});

afterAll(async () => {
  await colyseus.shutdown();
});

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createFastRoom() {
  return colyseus.createRoom<FastAbandonedRoom>(FAST_ROOM_NAME, { gameToken: devTestGameToken() });
}

function join(room: FastAbandonedRoom, options: object = {}) {
  return colyseus.connectTo(room, { gameToken: devTestGameToken(), ...options });
}

type TestClient = Awaited<ReturnType<typeof join>>;

/** C-13: marca a ambos "Listo" antes de que `a` (anfitrión) empiece. */
async function readyAndStart(room: FastAbandonedRoom, a: TestClient, b: TestClient): Promise<void> {
  a.send(GAME_MESSAGES.setReady, { ready: true });
  b.send(GAME_MESSAGES.setReady, { ready: true });
  await expect.poll(() => room.state.players.get(b.sessionId)?.ready, { timeout: 5000 }).toBe(true);
  a.send(GAME_MESSAGES.startGame, {});
  await expect.poll(() => room.state.phase, { timeout: 5000 }).toBe("starting");
  a.send(GAME_MESSAGES.enterMap, {});
  b.send(GAME_MESSAGES.enterMap, {});
  await expect.poll(() => room.state.phase, { timeout: 5000 }).toBe("playing");
}

/**
 * Espera a que ambos queden desconectados en el `state`. `?? false` (no
 * `.toBe(false)` a secas) porque, bajo carga fuerte, para cuando este poll
 * llega a mirar el `state` la cuenta atrás de abandono (`FAST_SECONDS`) puede
 * haber cumplido YA y purgado la plaza entera (`announceEnd` rechaza las
 * reconexiones pendientes, lo que dispara `onLeave`/`purgePlayer`) — "ya no
 * está en el mapa" es tan válido como "está y pone `connected: false`": en
 * ambos casos la plaza ya no cuenta como conectada. Nunca falla por una
 * máquina lenta, solo por que de verdad siga marcada como conectada.
 */
async function bothDisconnected(room: FastAbandonedRoom, a: TestClient, b: TestClient): Promise<void> {
  await expect
    .poll(() => room.state.players.get(a.sessionId)?.connected ?? false, { timeout: 5000 })
    .toBe(false);
  await expect
    .poll(() => room.state.players.get(b.sessionId)?.connected ?? false, { timeout: 5000 })
    .toBe(false);
}

/** La room ya no existe en el proceso (`onDispose` corrió): sondea, no duerme-y-mira-una-vez. */
async function waitForRoomDisposed(roomId: string): Promise<void> {
  await expect.poll(() => colyseus.getRoomById(roomId), { timeout: 5000, interval: 20 }).toBeUndefined();
}

function purchaseRow(id: string): InMemoryGameAccessPurchase {
  return {
    id,
    playSessionStartedAt: null,
    playSessionEndedAt: null,
    playSessionColyseusId: null,
    playSessionHeartbeatAt: null,
  };
}

function purchaseToken(purchaseId: string): string {
  const gameAccessConfig = readGameAccessTokenConfig()!;
  const now = Date.now();
  return signGameAccessToken(
    gameAccessConfig.secret,
    { kind: "purchase", purchaseId, userId: "user:ana", roomVersionId: ROOM_VERSION_ID },
    { now, expiresAt: now + 15 * 60 * 1000 },
  );
}

function noDurationPackage(): RoomPackage {
  const fixture = loadReyAldricRoomPackage();
  return parseRoomPackage({
    ...fixture,
    meta: { ...fixture.meta, id: "sala-sin-duracion", title: "Sala sin duración", timeLimitMinutes: null },
  } as unknown);
}

describe("GameRoom — partidas abandonadas (specs/11 §8.2, ADR-043)", () => {
  it(
    "todos desconectados: se cierra como abandonada y la room se destruye después",
    async () => {
      const room = await createFastRoom();
      const a = await join(room, { name: "Ana" });
      const b = await join(room, { name: "Bruno" });
      await readyAndStart(room, a, b);

      const tokenA = a.reconnectionToken;
      const tokenB = b.reconnectionToken;
      await a.leave(false);
      await b.leave(false);
      await bothDisconnected(room, a, b);

      // "abandoned" es el vocabulario del motor (`GameEndResult`); `toSessionResult`
      // lo traduce a "aborted" para el hito/la analítica (ver `end-game.ts`). Nunca se
      // comprueba `=== ""` antes de esto: para cuando llegamos aquí (ya hubo dos
      // `await` de red) el plazo acortado pudo haber cumplido de sobra en una CI lenta.
      await expect.poll(() => room.state.result, { timeout: 5000 }).toBe("abandoned");
      // Ya no admite ninguna reconexión (mismo camino que un fin normal, §8.1).
      await expect(colyseus.sdk.reconnect(tokenA)).rejects.toThrow();
      await expect(colyseus.sdk.reconnect(tokenB)).rejects.toThrow();

      // La room se destruye tras el margen de resultados: se sondea su desaparición
      // del proceso, no se duerme un margen fijo y se comprueba una vez.
      await waitForRoomDisposed(room.roomId);
      await expect(
        colyseus.sdk.joinById(room.roomId, { gameToken: devTestGameToken() }),
      ).rejects.toThrow();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "una reconexión antes del plazo cancela la cuenta atrás",
    async () => {
      // Ventana amplia (`ABANDON_RACE_SECONDS`, no `FAST_SECONDS`): este test
      // necesita completar `leave` + `reconnect` DENTRO del plazo para poder
      // demostrar algo.
      const room = await colyseus.createRoom<RaceAbandonedRoom>(RACE_ROOM_NAME, {
        gameToken: devTestGameToken(),
      });
      const a = await colyseus.connectTo(room, { gameToken: devTestGameToken(), name: "Ana" });
      const b = await colyseus.connectTo(room, { gameToken: devTestGameToken(), name: "Bruno" });
      await readyAndStart(room, a, b);

      const tokenA = a.reconnectionToken;
      await a.leave(false);
      await b.leave(false);
      await bothDisconnected(room, a, b);

      // Reconecta en cuanto el SDK lo permite (sin ningún `sleep` a medio plazo:
      // cronometrar "a mitad de la cuenta atrás" es justo el tipo de espera frágil
      // que se quiere evitar). Cualquier reconexión ANTES del plazo debe cancelarlo,
      // y esta es la más rápida posible — la prueba más exigente, no menos.
      await colyseus.sdk.reconnect(tokenA);
      await expect
        .poll(() => room.state.players.get(a.sessionId)?.connected, { timeout: 5000 })
        .toBe(true);

      // Pasado el plazo original (con margen amplio: demostrar un negativo es del
      // todo determinista siempre que el margen sea generoso, nunca al límite).
      await sleep(ABANDON_RACE_SECONDS * 1000 + FAST_SECONDS * 1000 * 5);
      expect(room.state.result).toBe("");
      expect(room.state.phase).toBe("playing");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "con un jugador conectado, la partida nunca se cierra por abandono",
    async () => {
      const room = await createFastRoom();
      const a = await join(room, { name: "Ana" });
      const b = await join(room, { name: "Bruno" });
      await readyAndStart(room, a, b);

      // Solo Ana se va; Bruno se queda conectado todo el rato.
      await a.leave(false);
      await expect
        .poll(() => room.state.players.get(a.sessionId)?.connected ?? false, { timeout: 5000 })
        .toBe(false);

      await sleep(FAST_SECONDS * 1000 * 5);
      expect(room.state.result).toBe("");
      expect(room.state.phase).toBe("playing");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "una sala sin duración también se cierra por abandono",
    async () => {
      const purchases = [purchaseRow("purchase-1")];
      const store = createInMemoryGameAccessStore({
        packages: { [ROOM_VERSION_ID]: noDurationPackage() },
        purchases,
      });
      configureGameAccessRuntime(store);

      const room = await colyseus.createRoom<FastAbandonedRoom>(FAST_ROOM_NAME, {
        gameToken: purchaseToken("purchase-1"),
      });
      const a = await colyseus.connectTo(room, {
        gameToken: purchaseToken("purchase-1"),
        name: "Ana",
      });
      const b = await colyseus.connectTo(room, {
        gameToken: purchaseToken("purchase-1"),
        name: "Bruno",
      });
      await readyAndStart(room, a, b);
      expect(room.state.endsAt).toBe(0); // sin duración: sin fecha de fin de cronómetro.

      await a.leave(false);
      await b.leave(false);
      await expect.poll(() => room.state.result, { timeout: 5000 }).toBe("abandoned");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "compra B2C: el abandono LIBERA la reclamación (no la consume)",
    async () => {
      const purchases = [purchaseRow("purchase-1")];
      const store = createInMemoryGameAccessStore({
        packages: { [ROOM_VERSION_ID]: noDurationPackage() },
        purchases,
      });
      configureGameAccessRuntime(store);

      const room = await colyseus.createRoom<FastAbandonedRoom>(FAST_ROOM_NAME, {
        gameToken: purchaseToken("purchase-1"),
      });
      const a = await colyseus.connectTo(room, {
        gameToken: purchaseToken("purchase-1"),
        name: "Ana",
      });
      const b = await colyseus.connectTo(room, {
        gameToken: purchaseToken("purchase-1"),
        name: "Bruno",
      });
      await readyAndStart(room, a, b);
      expect(purchases[0]!.playSessionStartedAt).not.toBeNull();

      await a.leave(false);
      await b.leave(false);
      await expect.poll(() => room.state.result, { timeout: 5000 }).toBe("abandoned");

      // Liberada: se puede volver a jugar. NO consumida (`playSessionEndedAt` sigue `null`).
      await expect.poll(() => purchases[0]!.playSessionStartedAt, { timeout: 5000 }).toBeNull();
      expect(purchases[0]!.playSessionEndedAt).toBeNull();
      expect(purchases[0]!.playSessionColyseusId).toBeNull();

      const retry = await colyseus.createRoom<FastAbandonedRoom>(FAST_ROOM_NAME, {
        gameToken: purchaseToken("purchase-1"),
      });
      expect(purchases[0]!.playSessionColyseusId).toBe(retry.roomId);
    },
    TEST_TIMEOUT_MS,
  );
});
