import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import {
  GAME_MESSAGES,
  GAME_ROOM_NAME,
  PLAYTEST_EXPIRED_CLOSE_CODE,
  PLAYTEST_INTERNAL_PATH,
  PLAYTEST_ROOM_NAME,
} from "../src/constants";
import { loadReyAldricRoomPackage } from "../src/game/room-packages";
import { DEV_PLAYTEST_SECRET, readPlaytestConfig } from "../src/playtest/config";
import { createPlaytestRouter, type PlaytestCreatedResponse } from "../src/playtest/http";
import {
  MAX_PLAYTESTS_PER_AUTHOR,
  PlaytestRegistry,
  playtestRegistry,
} from "../src/playtest/registry";
import { signPlaytestToken, verifyPlaytestToken } from "../src/playtest/token";
import { GameRoom } from "../src/rooms/game-room";
import { GameRoomState } from "../src/schema/game-state";
import type { PlaytestRoom } from "../src/rooms/playtest-room";
import { definePlaytestRoom } from "../src/server";
import { getFreePort } from "./helpers/free-port";

/**
 * Playtest del editor (ticket 3.8): registro congelado, token del link de
 * prueba, ruta interna web → Colyseus y la `PlaytestRoom` sobre Colyseus real
 * (puerto libre del SO). La `GameRoom` publicada se registra al lado para
 * comprobar que sigue igual.
 */

let colyseus: ColyseusTestServer;
let port: number;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(GAME_ROOM_NAME, GameRoom);
    definePlaytestRoom(server);
  },
  initializeExpress: (app) => {
    app.use(createPlaytestRouter());
  },
});

beforeAll(async () => {
  port = await getFreePort();
  colyseus = await boot(config, port);
});

afterEach(async () => {
  delete process.env.PLAYTEST_TTL_SECONDS;
  await colyseus.cleanup();
  playtestRegistry.clear();
});

afterAll(async () => {
  await colyseus.shutdown();
});

/** Borrador de prueba: el Rey Aldric con otra identidad (no es el fixture publicado). */
function draftPackage(): RoomPackage {
  const pkg = structuredClone(loadReyAldricRoomPackage());
  pkg.meta.id = "draft-sala-de-prueba";
  pkg.meta.version = "0.0.1-draft";
  return pkg;
}

function createPlaytest(body: unknown, secret: string | null = DEV_PLAYTEST_SECRET) {
  return fetch(`http://localhost:${port}${PLAYTEST_INTERNAL_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function createOk(pkg: RoomPackage = draftPackage()): Promise<PlaytestCreatedResponse> {
  const res = await createPlaytest({ roomPackage: pkg, authorId: "autora", draftRoomId: "sala-1" });
  expect(res.status).toBe(201);
  return (await res.json()) as PlaytestCreatedResponse;
}

function joinPlaytest(created: Pick<PlaytestCreatedResponse, "playtestId" | "token">) {
  return colyseus.sdk.joinOrCreate<GameRoomState>(PLAYTEST_ROOM_NAME, {
    playtestId: created.playtestId,
    token: created.token,
  });
}

describe("token del link de prueba", () => {
  it("firma y verifica; rechaza firma alterada, otro secreto y caducidad", () => {
    const now = 1_000_000_000_000;
    const token = signPlaytestToken("s3cret", { playtestId: "pt-1", expiresAt: now + 60_000 });
    expect(verifyPlaytestToken("s3cret", token, now)).toEqual({
      ok: true,
      payload: { v: 1, pid: "pt-1", exp: (now + 60_000) / 1000 },
    });
    const [body, signature] = token.split("~");
    const forged = `${Buffer.from(JSON.stringify({ v: 1, pid: "pt-2", exp: 9e9 })).toString("base64url")}~${signature}`;
    expect(verifyPlaytestToken("s3cret", forged, now)).toEqual({
      ok: false,
      error: "BAD_SIGNATURE",
    });
    expect(verifyPlaytestToken("otro", token, now)).toEqual({ ok: false, error: "BAD_SIGNATURE" });
    expect(verifyPlaytestToken("s3cret", token, now + 60_000)).toEqual({
      ok: false,
      error: "EXPIRED",
    });
    expect(verifyPlaytestToken("s3cret", `${body}`, now)).toEqual({
      ok: false,
      error: "MALFORMED",
    });
    expect(verifyPlaytestToken("s3cret", 42, now)).toEqual({ ok: false, error: "MALFORMED" });
  });

  it("sin PLAYTEST_SECRET en producción el playtest queda desactivado", () => {
    expect(readPlaytestConfig({ NODE_ENV: "production" })).toBeNull();
    expect(readPlaytestConfig({ NODE_ENV: "production", PLAYTEST_SECRET: "x" })?.secret).toBe("x");
    expect(readPlaytestConfig({})?.secret).toBe(DEV_PLAYTEST_SECRET);
    expect(readPlaytestConfig({ PLAYTEST_TTL_SECONDS: "999999" })?.ttlSeconds).toBe(24 * 60 * 60);
  });
});

describe("registro de playtests", () => {
  it("congela el paquete: mutar el original después no cambia lo registrado", () => {
    const registry = new PlaytestRegistry();
    const pkg = draftPackage();
    const entry = registry.register({
      roomPackage: pkg,
      authorId: "autora",
      draftRoomId: "sala-1",
      ttlSeconds: 60,
    });
    pkg.meta.title = "Editado después";
    pkg.objects.length = 0;
    const frozen = registry.packageFor(entry.playtestId)!;
    expect(frozen.meta.title).toEqual(draftPackage().meta.title);
    expect(frozen.objects.length).toBe(draftPackage().objects.length);
    // Cada room recibe su propia copia.
    frozen.objects.length = 0;
    expect(registry.packageFor(entry.playtestId)!.objects.length).toBeGreaterThan(0);
  });

  it("caduca y limita los playtests vivos por autor", () => {
    let now = 0;
    const registry = new PlaytestRegistry(() => now);
    const input = {
      roomPackage: draftPackage(),
      authorId: "autora",
      draftRoomId: "s",
      ttlSeconds: 10,
    };
    const first = registry.register(input);
    now = 9_999;
    expect(registry.get(first.playtestId)).toBeDefined();
    now = 10_000;
    expect(registry.get(first.playtestId)).toBeUndefined();
    expect(registry.packageFor(first.playtestId)).toBeUndefined();

    const ids = Array.from({ length: MAX_PLAYTESTS_PER_AUTHOR + 1 }, () => {
      now += 1;
      return registry.register(input).playtestId;
    });
    registry.register({ ...input, authorId: "otra" });
    expect(registry.get(ids[0]!)).toBeUndefined();
    expect(ids.slice(1).every((id) => registry.get(id))).toBe(true);
    expect(registry.size).toBe(MAX_PLAYTESTS_PER_AUTHOR + 1);
  });
});

describe("POST /internal/playtests", () => {
  it("exige el secreto compartido y un RoomPackage válido", async () => {
    const body = { roomPackage: draftPackage(), authorId: "autora", draftRoomId: "sala-1" };
    expect((await createPlaytest(body, null)).status).toBe(401);
    expect((await createPlaytest(body, "no-es-el-secreto")).status).toBe(401);
    expect((await createPlaytest({ authorId: "autora" })).status).toBe(400);
    const invalid = await createPlaytest({ ...body, roomPackage: { meta: {} } });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_PACKAGE" } });
    expect(playtestRegistry.size).toBe(0);
  });

  it("levanta una room jugable con el paquete del borrador y un cliente juega con el link", async () => {
    const created = await createOk();
    expect(created.token).toMatch(/^[\w-]+~[\w-]+$/u);
    expect(created.expiresAt).toBeGreaterThan(Date.now());
    const room = matchMaker.getLocalRoomById(created.roomId) as PlaytestRoom;
    expect(room.roomName).toBe(PLAYTEST_ROOM_NAME);

    const client = await joinPlaytest(created);
    expect(client.roomId).toBe(created.roomId);
    await client.waitForInitialState();
    expect(client.state.roomPackageId).toBe("draft-sala-de-prueba");
    expect(client.state.roomPackageVersion).toBe("0.0.1-draft");

    const intro = client.waitForMessage(GAME_MESSAGES.dialogShow);
    client.send(GAME_MESSAGES.startGame, {});
    expect(await intro).toEqual({ dialogId: "d-intro" });

    const granted = client.waitForMessage(GAME_MESSAGES.itemGranted);
    client.send(GAME_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    expect(await granted).toEqual({ playerId: client.sessionId, itemId: "llave-bronce" });
  });

  it("un amigo con el link entra en la misma partida; sin token válido no", async () => {
    const created = await createOk();
    const author = await joinPlaytest(created);
    const friend = await joinPlaytest(created);
    expect(friend.roomId).toBe(author.roomId);

    await expect(
      colyseus.sdk.joinOrCreate(PLAYTEST_ROOM_NAME, { playtestId: created.playtestId }),
    ).rejects.toThrow();
    await expect(
      colyseus.sdk.joinById(created.roomId, { playtestId: created.playtestId, token: "x~y" }),
    ).rejects.toThrow();
    // El token de otro playtest no abre este.
    const other = await createOk();
    await expect(
      colyseus.sdk.joinById(created.roomId, {
        playtestId: created.playtestId,
        token: other.token,
      }),
    ).rejects.toThrow();
  });

  it("si el anfitrión se va, el siguiente jugador conectado puede empezar", async () => {
    const created = await createOk();
    const first = await joinPlaytest(created);
    const second = await joinPlaytest(created);
    await expect.poll(() => second.state.hostId).toBe(first.sessionId);
    await first.leave();
    await expect.poll(() => second.state.hostId).toBe(second.sessionId);
    const intro = second.waitForMessage(GAME_MESSAGES.dialogShow);
    second.send(GAME_MESSAGES.startGame, {});
    expect(await intro).toEqual({ dialogId: "d-intro" });
  });

  it("al vaciarse la room se destruye y el link la recrea desde el paquete congelado", async () => {
    const created = await createOk();
    const first = await joinPlaytest(created);
    await first.leave();
    await expect.poll(() => matchMaker.getLocalRoomById(created.roomId)).toBeUndefined();

    const again = await joinPlaytest(created);
    expect(again.roomId).not.toBe(created.roomId);
    await again.waitForInitialState();
    expect(again.state.roomPackageId).toBe("draft-sala-de-prueba");
  });

  it("al caducar cierra la room y el link deja de servir", async () => {
    process.env.PLAYTEST_TTL_SECONDS = "1";
    const created = await createOk();
    const client = await joinPlaytest(created);
    const closed = new Promise<number>((resolve) => client.onLeave((code) => resolve(code)));
    expect(await closed).toBe(PLAYTEST_EXPIRED_CLOSE_CODE);
    await expect(joinPlaytest(created)).rejects.toThrow();
  });

  it("la GameRoom publicada sigue cargando solo el fixture por id", async () => {
    const room = await colyseus.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const client = await colyseus.connectTo(room);
    await expect.poll(() => client.state.roomPackageId).toBe("room-rey-aldric");
    await expect(
      colyseus.sdk.create(GAME_ROOM_NAME, { packageId: "draft-sala-de-prueba" }),
    ).rejects.toThrow();
  });
});
