import { Client } from "@colyseus/sdk";
import {
  CHAT_MESSAGE,
  createGameServer,
  ERROR_MESSAGE,
  EVENT_ROOM_NAME,
  GAME_ERRORS,
  GAME_MAX_STEP,
  GAME_MESSAGES,
  GAME_ROOM_NAME,
  MEDIA_TOKEN_MESSAGE,
  MEDIA_TOKEN_REQUEST_MESSAGE,
  OUT_OF_BOUNDS,
  PLAYTEST_EXPIRED_CLOSE_CODE,
  PLAYTEST_ROOM_NAME,
} from "@escaperoom/colyseus-server";
import { loadRoomPackage, toRuntimeModel } from "@escaperoom/game-runtime";
import {
  CHAT_PROTOCOL_MESSAGE,
  createNetworkGameClient,
  createReadOnlyGameClient,
  EVENT_ROOM,
  GAME_MAX_STEP_CELLS,
  GAME_PROTOCOL,
  GAME_PROTOCOL_ERRORS,
  GAME_ROOM,
  MEDIA_PROTOCOL,
  MOVE_OUT_OF_BOUNDS,
  PLAYTEST_EXPIRED_CLOSE,
  PLAYTEST_ROOM,
  PROTOCOL_ERROR_MESSAGE,
  stepsBetween,
  type GameEvent,
  type GameSnapshot,
  type NetworkGameClient,
} from "@escaperoom/game-runtime/session";
import {
  DEV_JOIN_TOKEN_SECRET,
  signJoinToken,
  signSpectatorToken,
} from "@escaperoom/shared/join-token";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EVENT_ROOM_NAME as WEB_EVENT_ROOM_NAME } from "../src/lib/colyseus";
import {
  eventPlayPath,
  joinGameRoom,
  joinOptions,
  readJoinTokenFromHash,
  type GameRoomHandle,
} from "../src/lib/game-net";
import { readReyAldricRoomPackageJson } from "../src/lib/room-preview-fixture";
import { freePort } from "./helpers/free-port";

/**
 * Capa de cliente de la partida en red (fase 2) contra una `GameRoom` real de
 * Colyseus (puerto libre del SO), sin navegador: la web se une con
 * `@colyseus/sdk`, `createNetworkGameClient` aplica el estado sincronizado al
 * modelo que consume el runtime y las acciones salen como mensajes del
 * protocolo que el servidor acepta. Dos clientes ven el mismo estado tras una
 * acción de uno.
 */

const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
const model = toRuntimeModel(roomPackage, { locale: "es" });
const LOCK_CODES = roomPackage.puzzles.flatMap((puzzle) =>
  puzzle.type === "code_lock" ? [puzzle.code] : [],
);

let server: ReturnType<typeof createGameServer>;
let url: string;
const opened: Array<{ room: GameRoomHandle; client: NetworkGameClient }> = [];

beforeAll(async () => {
  for (const key of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) {
    delete process.env[key];
  }
  const port = await freePort();
  server = createGameServer();
  await server.listen(port);
  url = `ws://localhost:${port}`;
});

afterEach(async () => {
  for (const { room, client } of opened.splice(0)) {
    client.dispose();
    await room.leave(true).catch(() => undefined);
  }
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

interface Player {
  room: GameRoomHandle;
  client: NetworkGameClient;
  events: GameEvent[];
}

async function join(target: Parameters<typeof joinGameRoom>[1], name: string): Promise<Player> {
  const room = await joinGameRoom(new Client(url), target, name);
  const client = createNetworkGameClient(room);
  const events: GameEvent[] = [];
  client.onEvent((event) => events.push(event));
  opened.push({ room, client });
  return { room, client, events };
}

/** Espera a que la instantánea del cliente cumpla `predicate` (en cada parche). */
function until(player: Player, predicate: (snapshot: GameSnapshot) => boolean): Promise<void> {
  if (predicate(player.client.getSnapshot())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timeout: ${JSON.stringify(player.client.getSnapshot()).slice(0, 400)}`));
    }, 5000);
    const off = player.client.subscribe((snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
}

/** Siguiente evento de `type` (registrado antes de enviar la acción). */
function nextEvent<T extends GameEvent["type"]>(
  player: Player,
  type: T,
): Promise<Extract<GameEvent, { type: T }>> {
  return new Promise((resolve) => {
    const off = player.client.onEvent((event) => {
      if (event.type !== type) return;
      off();
      resolve(event as Extract<GameEvent, { type: T }>);
    });
  });
}

describe("protocolo espejo del runtime = constantes del servidor", () => {
  it("mensajes, errores, rooms y límites coinciden con @escaperoom/colyseus-server", () => {
    expect(GAME_PROTOCOL).toEqual(GAME_MESSAGES);
    expect(GAME_PROTOCOL_ERRORS).toEqual(GAME_ERRORS);
    expect(GAME_ROOM).toBe(GAME_ROOM_NAME);
    expect(PLAYTEST_ROOM).toBe(PLAYTEST_ROOM_NAME);
    expect(EVENT_ROOM).toBe(EVENT_ROOM_NAME);
    expect(EVENT_ROOM).toBe(WEB_EVENT_ROOM_NAME);
    expect(PLAYTEST_EXPIRED_CLOSE).toBe(PLAYTEST_EXPIRED_CLOSE_CODE);
    expect(PROTOCOL_ERROR_MESSAGE).toBe(ERROR_MESSAGE);
    expect(CHAT_PROTOCOL_MESSAGE).toBe(CHAT_MESSAGE);
    expect(MEDIA_PROTOCOL).toEqual({
      request: MEDIA_TOKEN_REQUEST_MESSAGE,
      token: MEDIA_TOKEN_MESSAGE,
    });
    expect(GAME_MAX_STEP_CELLS).toBe(GAME_MAX_STEP);
    expect(MOVE_OUT_OF_BOUNDS).toBe(OUT_OF_BOUNDS);
  });

  it("las opciones de join solo llevan el id del paquete, nunca el paquete", () => {
    expect(joinOptions({ kind: "game", packageId: "room-rey-aldric" }, " Ana<b> ")).toEqual({
      name: "Anab",
      packageId: "room-rey-aldric",
    });
    expect(joinOptions({ kind: "game", roomId: "abc" })).toEqual({});
    expect(joinOptions({ kind: "playtest", playtestId: "pt", token: "t~s" }, "")).toEqual({
      playtestId: "pt",
      token: "t~s",
    });
    // En un evento el nombre lo fija el `joinToken`: el cliente no lo manda.
    expect(joinOptions({ kind: "event", sessionId: "s1", joinToken: "jwt" }, "Ana")).toEqual({
      sessionId: "s1",
      joinToken: "jwt",
    });
    // El observador (5.9) solo presenta su token: ni nombre ni joinToken.
    expect(
      joinOptions({ kind: "spectate", sessionId: "s1", spectatorToken: "spt" }, "Profe"),
    ).toEqual({ sessionId: "s1", spectatorToken: "spt" });
  });

  it("el link de evento lleva el joinToken en el fragmento (no llega al servidor web)", () => {
    const path = eventPlayPath("s-1", "a.b.c");
    expect(path).toBe("/play?session=s-1#joinToken=a.b.c");
    expect(readJoinTokenFromHash(new URL(`https://x${path}`).hash)).toBe("a.b.c");
    expect(readJoinTokenFromHash("")).toBeNull();
    expect(readJoinTokenFromHash(`#joinToken=${"x".repeat(3000)}`)).toBeNull();
  });
});

describe("cliente de red contra una GameRoom real", () => {
  it("entra en la room `event` de 5.8 con el joinToken del canje (y sin él no)", async () => {
    const now = Date.now();
    const joinToken = signJoinToken(
      DEV_JOIN_TOKEN_SECRET,
      {
        playerId: "guest:1",
        displayName: "Invitada",
        eventId: "e-1",
        sessionId: "sesion-1",
        groupId: null,
      },
      { now, expiresAt: now + 60_000 },
    );
    const guest = await join({ kind: "event", sessionId: "sesion-1", joinToken }, "Ignorado");
    await until(guest, (snapshot) => snapshot.self !== null);
    expect(guest.room.name).toBe(EVENT_ROOM);
    expect(guest.client.getSnapshot().self).toMatchObject({ name: "Invitada", isHost: true });
    const intro = nextEvent(guest, "dialog_show");
    guest.client.startGame();
    expect((await intro).dialogId).toBe("d-intro");

    await expect(
      joinGameRoom(new Client(url), { kind: "event", sessionId: "sesion-1", joinToken: "x.y.z" }),
    ).rejects.toThrow();
    await expect(
      joinGameRoom(new Client(url), { kind: "event", sessionId: "otra", joinToken }),
    ).rejects.toThrow();
  });

  it("el organizador observa la room `event` en solo lectura (5.9): ve el estado, no actúa", async () => {
    const now = Date.now();
    const joinToken = signJoinToken(
      DEV_JOIN_TOKEN_SECRET,
      {
        playerId: "guest:2",
        displayName: "Lía",
        eventId: "e-2",
        sessionId: "sesion-2",
        groupId: null,
      },
      { now, expiresAt: now + 60_000 },
    );
    const spectatorToken = signSpectatorToken(
      DEV_JOIN_TOKEN_SECRET,
      { organizerId: "profe", eventId: "e-2", sessionId: "sesion-2" },
      { now, expiresAt: now + 60_000 },
    );
    const target = { kind: "spectate" as const, sessionId: "sesion-2", spectatorToken };

    // Sin partida no hay nada que observar: el observador no crea la room.
    await expect(joinGameRoom(new Client(url), target)).rejects.toThrow();

    const guest = await join({ kind: "event", sessionId: "sesion-2", joinToken }, "");
    await until(guest, (snapshot) => snapshot.self !== null);
    const intro = nextEvent(guest, "dialog_show");
    guest.client.startGame();
    await intro;

    const room = await joinGameRoom(new Client(url), target);
    expect(room.roomId).toBe(guest.room.roomId);
    const network = createNetworkGameClient(room);
    const watcher = createReadOnlyGameClient(network);
    const spectator: Player = { room, client: watcher, events: [] };
    watcher.onEvent((event) => spectator.events.push(event));
    opened.push({ room, client: network });
    await until(spectator, (snapshot) => snapshot.phase === "playing");
    expect(watcher.getSnapshot().players.map((player) => player.name)).toEqual(["Lía"]);
    expect(watcher.getSnapshot().self).toBeNull();

    // El cliente de solo lectura no envía nada…
    const sent: string[] = [];
    const send = room.send.bind(room);
    room.send = ((type: string, payload?: unknown) => {
      sent.push(type);
      send(type, payload);
    }) as typeof room.send;
    watcher.startGame();
    watcher.interact("cuadro-aurelio");
    watcher.attempt("p-candado-arca", { code: "4732" });
    watcher.requestHint("p-candado-arca");
    watcher.sendChat("hola");
    watcher.requestMediaToken();
    expect(sent).toEqual([]);

    // …y si algo lo enviara igualmente, la room lo rechaza.
    const denied = nextEvent(spectator, "error");
    room.send(GAME_PROTOCOL.interact, { objectId: "cuadro-aurelio" });
    expect((await denied).code).toBe(GAME_PROTOCOL_ERRORS.permissionDenied);

    // Lo que hace el jugador sí lo ve.
    guest.client.interact("cuadro-aurelio");
    await until(spectator, (snapshot) => snapshot.puzzles["p-llave-cuadro"]?.state === "solved");
  });

  it("se une, aplica el estado sincronizado al modelo del runtime y el servidor acepta sus acciones", async () => {
    const ana = await join({ kind: "game", packageId: "room-rey-aldric" }, "Ana");
    await until(ana, (snapshot) => snapshot.self !== null);
    const first = ana.client.getSnapshot();
    expect(first).toMatchObject({ phase: "lobby", roomPackageId: "room-rey-aldric" });
    expect(first.self).toMatchObject({ name: "Ana", isHost: true, roomId: model.subrooms[0]!.id });
    // Cada objeto del estado existe en el modelo que pinta Phaser (mismos ids).
    for (const objectId of Object.keys(first.objects)) {
      expect(model.objectsById[objectId], objectId).toBeDefined();
    }
    for (const puzzleId of Object.keys(first.puzzles)) {
      expect(model.puzzlesById[puzzleId], puzzleId).toBeDefined();
    }

    // Medios (2.2) sobre la GameRoom: sin claves, «sin medios».
    const media = nextEvent(ana, "media_token");
    ana.client.requestMediaToken("player");
    expect((await media).payload).toMatchObject({
      configured: false,
      identity: ana.room.sessionId,
    });

    // Antes de empezar el servidor rechaza las acciones de juego.
    const rejected = nextEvent(ana, "error");
    ana.client.interact("cuadro-aurelio");
    expect((await rejected).code).toBe(GAME_PROTOCOL_ERRORS.invalidState);

    const intro = nextEvent(ana, "dialog_show");
    ana.client.startGame();
    expect(await intro).toEqual({ type: "dialog_show", dialogId: "d-intro" });
    await until(ana, (snapshot) => snapshot.phase === "playing" && snapshot.endsAt > 0);

    // Movimiento autoritativo: pasos por debajo del salto máximo hasta la placa.
    const start = ana.client.getSnapshot().self!;
    for (const step of stepsBetween(start, { x: 6, y: 11 })) ana.client.move(step.x, step.y);
    await until(ana, (snapshot) => snapshot.self?.x === 6 && snapshot.self?.y === 11);
    await until(ana, (snapshot) => snapshot.objects["placa-izq"] === "down");

    // Un salto ilegal se rechaza y la posición no cambia.
    const tooFast = nextEvent(ana, "error");
    ana.client.move(15, 11);
    expect((await tooFast).code).toBe(GAME_PROTOCOL_ERRORS.moveTooFast);
    expect(ana.client.getSnapshot().self).toMatchObject({ x: 6, y: 11 });

    // Panel de puzzle: vista pública por mensaje dirigido y desenlace del servidor.
    const view = nextEvent(ana, "puzzle_view");
    ana.client.openPuzzle("p-candado-arca");
    expect((await view).view).toMatchObject({ type: "code_lock" });
    const wrong = nextEvent(ana, "attempt_result");
    ana.client.attempt("p-candado-arca", { code: "0000" });
    expect(await wrong).toMatchObject({ ok: false, error: "wrong_code" });
    await until(ana, (snapshot) => snapshot.puzzles["p-candado-arca"]?.attempts === 1);
    ana.client.closePuzzle("p-candado-arca");

    expect(JSON.stringify(ana.events)).not.toMatch(new RegExp(LOCK_CODES.join("|")));
  });

  it("dos clientes ven el mismo estado tras una acción de uno (inventario, objetos, chat, posición)", async () => {
    const ana = await join({ kind: "game", packageId: "room-rey-aldric" }, "Ana");
    await until(ana, (snapshot) => snapshot.self !== null);
    const bruno = await join({ kind: "game", roomId: ana.room.roomId }, "Bruno");
    expect(bruno.room.roomId).toBe(ana.room.roomId);
    await until(ana, (snapshot) => snapshot.players.length === 2);
    await until(bruno, (snapshot) => snapshot.players.length === 2);
    expect(bruno.client.getSnapshot().self).toMatchObject({ name: "Bruno", isHost: false });

    // El invitado no puede empezar; el anfitrión sí, y ambos pasan a jugar.
    const denied = nextEvent(bruno, "error");
    bruno.client.startGame();
    expect((await denied).code).toBe(GAME_PROTOCOL_ERRORS.permissionDenied);
    ana.client.startGame();
    await Promise.all([
      until(ana, (snapshot) => snapshot.phase === "playing"),
      until(bruno, (snapshot) => snapshot.phase === "playing"),
    ]);

    // Ana inspecciona el cuadro: los dos ven la llave en el inventario de Ana.
    const granted = nextEvent(bruno, "item_granted");
    ana.client.interact("cuadro-aurelio");
    expect(await granted).toMatchObject({ playerId: ana.room.sessionId, itemId: "llave-bronce" });
    await until(ana, (snapshot) => snapshot.inventory.includes("llave-bronce"));
    await until(bruno, (snapshot) =>
      (snapshot.inventories[ana.room.sessionId] ?? []).includes("llave-bronce"),
    );
    expect(bruno.client.getSnapshot().inventory).toEqual([]);

    // Ana abre el armario con la llave: Bruno ve el cambio de estado del objeto.
    const armario = nextEvent(bruno, "object_state_changed");
    ana.client.useItem("llave-bronce", "armario");
    expect(await armario).toMatchObject({ objectId: "armario", state: "open" });
    await until(bruno, (snapshot) => snapshot.objects["armario"] === "open");

    // Chat de la partida (2.1): Bruno lo ve con el autor.
    ana.client.sendChat("¡Tengo la llave!");
    await until(bruno, (snapshot) => snapshot.chat.length === 1);
    expect(bruno.client.getSnapshot().chat[0]).toMatchObject({
      authorId: ana.room.sessionId,
      authorName: "Ana",
      text: "¡Tengo la llave!",
    });

    // Posición: Bruno ve a Ana moverse (la escena interpola su avatar).
    const from = ana.client.getSnapshot().self!;
    for (const step of stepsBetween(from, { x: from.x - 2, y: from.y })) {
      ana.client.move(step.x, step.y);
    }
    await until(bruno, (snapshot) => {
      const other = snapshot.players.find((player) => player.id === ana.room.sessionId);
      return other?.x === from.x - 2 && other.y === from.y;
    });

    // Mismo estado público en ambos lados.
    const a = ana.client.getSnapshot();
    const b = bruno.client.getSnapshot();
    expect(b.objects).toEqual(a.objects);
    expect(b.puzzles).toEqual(a.puzzles);
    expect(b.inventories).toEqual(a.inventories);
    expect(b.flags).toEqual(a.flags);
  });
});
