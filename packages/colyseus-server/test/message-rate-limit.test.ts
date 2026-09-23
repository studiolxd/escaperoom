import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { CHAT_MESSAGE, ERROR_MESSAGE, GAME_MESSAGES, GAME_ROOM_NAME } from "../src/constants";
import {
  GAME_MESSAGE_RATE_LIMITS,
  MESSAGE_RATE_LIMITED_ERROR,
  MessageRateLimiter,
  readGameMessageRateLimits,
} from "../src/message-rate-limit";
import { GameRoom } from "../src/rooms/game-room";
import { getFreePort } from "./helpers/free-port";

/**
 * Rate limit por mensaje de la `GameRoom` (ticket 6.3, specs/11 §9): la
 * lógica del limitador con reloj inyectado y, sobre Colyseus real, un cliente
 * que inunda `move` sin afectar al otro jugador de la partida.
 */

function clock(start = 10_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("MessageRateLimiter", () => {
  it("move: 10/s; el 11.º se rechaza y solo se avisa una vez por ventana", () => {
    const c = clock();
    const limiter = new MessageRateLimiter(GAME_MESSAGE_RATE_LIMITS, c.now);
    for (let i = 0; i < 10; i += 1) {
      expect(limiter.check("a", GAME_MESSAGES.move, {}).ok).toBe(true);
    }
    const first = limiter.check("a", GAME_MESSAGES.move, {});
    expect(first).toMatchObject({ ok: false, bucket: "move", notify: true });
    expect(limiter.check("a", GAME_MESSAGES.move, {})).toMatchObject({ ok: false, notify: false });

    c.advance(1_000);
    expect(limiter.check("a", GAME_MESSAGES.move, {}).ok).toBe(true);
  });

  it("la cuota es por jugador: la de «a» no toca la de «b»", () => {
    const c = clock();
    const limiter = new MessageRateLimiter(GAME_MESSAGE_RATE_LIMITS, c.now);
    for (let i = 0; i < 20; i += 1) limiter.check("a", GAME_MESSAGES.interact, {});
    expect(limiter.check("a", GAME_MESSAGES.interact, {}).ok).toBe(false);
    expect(limiter.check("b", GAME_MESSAGES.interact, {}).ok).toBe(true);
  });

  it("puzzle_attempt: 2/s POR PUZZLE", () => {
    const c = clock();
    const limiter = new MessageRateLimiter(GAME_MESSAGE_RATE_LIMITS, c.now);
    const attempt = (puzzleId: string) =>
      limiter.check("a", GAME_MESSAGES.puzzleAttempt, { puzzleId, attempt: {} });
    expect(attempt("p-1").ok).toBe(true);
    expect(attempt("p-1").ok).toBe(true);
    expect(attempt("p-1")).toMatchObject({ ok: false, bucket: "puzzle_attempt:p-1" });
    expect(attempt("p-2").ok).toBe(true);
  });

  it("tope total por jugador, también para tipos sin límite propio (chat)", () => {
    const c = clock();
    const limiter = new MessageRateLimiter(GAME_MESSAGE_RATE_LIMITS, c.now);
    const { max } = GAME_MESSAGE_RATE_LIMITS.total;
    for (let i = 0; i < max; i += 1) expect(limiter.check("a", CHAT_MESSAGE, {}).ok).toBe(true);
    expect(limiter.check("a", CHAT_MESSAGE, {})).toMatchObject({ ok: false, bucket: "*" });
  });

  it("puzzleIds inventados no hacen crecer el estado sin fin", () => {
    const c = clock();
    const limiter = new MessageRateLimiter(GAME_MESSAGE_RATE_LIMITS, c.now);
    for (let i = 0; i < 1_000; i += 1) {
      limiter.check("a", GAME_MESSAGES.puzzleAttempt, { puzzleId: `p-${i}` });
      c.advance(40);
    }
    const { clients } = limiter as unknown as {
      clients: Map<string, { buckets: Map<string, unknown> }>;
    };
    expect(clients.get("a")!.buckets.size).toBeLessThanOrEqual(64);
  });

  it("forget libera el estado del jugador", () => {
    const limiter = new MessageRateLimiter(GAME_MESSAGE_RATE_LIMITS, clock().now);
    for (let i = 0; i < 11; i += 1) limiter.check("a", GAME_MESSAGES.move, {});
    limiter.forget("a");
    expect(limiter.check("a", GAME_MESSAGES.move, {}).ok).toBe(true);
  });

  it("GAME_MESSAGE_RATE_LIMIT=off lo apaga; por defecto está encendido", () => {
    expect(readGameMessageRateLimits({})).toBe(GAME_MESSAGE_RATE_LIMITS);
    expect(readGameMessageRateLimits({ GAME_MESSAGE_RATE_LIMIT: "off" })).toBeNull();
  });
});

describe("GameRoom — un cliente que inunda mensajes", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    delete process.env.GAME_MESSAGE_RATE_LIMIT;
    colyseus = await boot(
      defineConfig({
        initializeGameServer: (server) => {
          server.define(GAME_ROOM_NAME, GameRoom);
        },
      }),
      await getFreePort(),
    );
  });

  afterEach(async () => {
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  it("se le descarta lo que excede su cuota (un solo aviso) y el otro jugador juega igual", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const flooder = await colyseus.connectTo(room, { name: "Ana" });
    const other = await colyseus.connectTo(room, { name: "Bruno" });
    flooder.send(GAME_MESSAGES.startGame, {});
    await expect.poll(() => other.state.phase).toBe("playing");

    const errors: Array<{ code: string; messageType?: string; retryAfterMs?: number }> = [];
    flooder.onMessage(ERROR_MESSAGE, (error) => errors.push(error));
    const otherErrors: unknown[] = [];
    other.onMessage(ERROR_MESSAGE, (error) => otherErrors.push(error));

    // Ráfaga de 30 pasos cortos (válidos uno a uno) en el mismo instante.
    const start = room.state.players.get(flooder.sessionId)!;
    const x0 = start.x;
    const y0 = start.y;
    const step = 0.05;
    const direction = x0 >= 3 ? -1 : 1;
    for (let i = 1; i <= 30; i += 1) {
      flooder.send(GAME_MESSAGES.move, { x: x0 + direction * step * i, y: y0 });
    }

    // Solo cuentan los 10 primeros (10/s): la posición se queda en el 10.º paso.
    const limit = GAME_MESSAGE_RATE_LIMITS.perType[GAME_MESSAGES.move]!.max;
    const expectedX = x0 + direction * step * limit;
    await expect
      .poll(() => Math.abs(room.state.players.get(flooder.sessionId)!.x - expectedX))
      .toBeLessThan(1e-6);
    await expect.poll(() => errors.length).toBe(1);
    expect(errors[0]).toMatchObject({ code: MESSAGE_RATE_LIMITED_ERROR, messageType: "move" });
    expect(errors[0]!.retryAfterMs).toBeGreaterThan(0);

    // El otro jugador, en la misma room y en la misma ventana, no nota nada.
    const b = room.state.players.get(other.sessionId)!;
    const bx0 = b.x;
    const bDirection = bx0 >= 3 ? -1 : 1;
    for (let i = 1; i <= 5; i += 1) {
      other.send(GAME_MESSAGES.move, { x: bx0 + bDirection * 0.2 * i, y: b.y });
    }
    await expect
      .poll(() => Math.abs(room.state.players.get(other.sessionId)!.x - (bx0 + bDirection)))
      .toBeLessThan(1e-6);
    other.send(CHAT_MESSAGE, { text: "¿Seguimos?" });
    await expect.poll(() => room.state.chat.length).toBe(1);
    expect(otherErrors).toEqual([]);

    // Pasada la ventana, el que inundó vuelve a moverse.
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    flooder.send(GAME_MESSAGES.move, { x: expectedX + direction * step, y: y0 });
    await expect
      .poll(() =>
        Math.abs(room.state.players.get(flooder.sessionId)!.x - (expectedX + direction * step)),
      )
      .toBeLessThan(1e-6);
    expect(errors).toHaveLength(1);
  });
});
