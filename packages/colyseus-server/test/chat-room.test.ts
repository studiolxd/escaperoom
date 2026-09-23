import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import {
  CHAT_INVALID_PAYLOAD_ERROR,
  CHAT_MESSAGE,
  CHAT_RATE_LIMITED_ERROR,
  ERROR_MESSAGE,
  LOBBY_ROOM_NAME,
} from "../src/constants";
import { LobbyTestRoom } from "../src/rooms/lobby-test-room";
import { getFreePort } from "./helpers/free-port";

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(LOBBY_ROOM_NAME, LobbyTestRoom);
  },
});

beforeAll(async () => {
  // Puerto libre asignado por el SO: evita EADDRINUSE entre procesos en paralelo.
  colyseus = await boot(config, await getFreePort());
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe("chat del lobby_test (integración con @colyseus/testing)", () => {
  it("dos clientes chatean y ambos ven los mensajes en el state", async () => {
    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const clientA = await colyseus.connectTo(room);
    const clientB = await colyseus.connectTo(room);

    const patchB = clientB.waitForNextPatch();
    clientA.send(CHAT_MESSAGE, { text: "hola desde A" });
    await patchB;

    expect(room.state.chat).toHaveLength(1);
    expect(clientB.state.chat).toHaveLength(1);
    const first = room.state.chat.at(-1);
    expect(first?.text).toBe("hola desde A");
    expect(first?.authorId).toBe(clientA.sessionId);
    expect(first?.authorName).toBe("Jugador 1");

    const patchA = clientA.waitForNextPatch();
    clientB.send(CHAT_MESSAGE, { text: "hola desde B" });
    await patchA;

    expect(clientA.state.chat).toHaveLength(2);
    expect(room.state.chat.at(-1)?.text).toBe("hola desde B");
  });

  it("un jugador que se une después recibe el historial", async () => {
    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const clientA = await colyseus.connectTo(room);

    const patchA = clientA.waitForNextPatch();
    clientA.send(CHAT_MESSAGE, { text: "primero" });
    await patchA;
    const patchA2 = clientA.waitForNextPatch();
    clientA.send(CHAT_MESSAGE, { text: "segundo" });
    await patchA2;

    // `connectTo` espera al estado inicial: el historial ya viene incluido.
    const clientB = await colyseus.connectTo(room);
    expect(clientB.state.chat).toHaveLength(2);
    expect(clientB.state.chat.at(-1)?.text).toBe("segundo");
  });

  it("rechaza el tercer mensaje en menos de un segundo", async () => {
    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const clientA = await colyseus.connectTo(room);

    const errorPromise = clientA.waitForMessage(ERROR_MESSAGE);
    clientA.send(CHAT_MESSAGE, { text: "uno" });
    clientA.send(CHAT_MESSAGE, { text: "dos" });
    clientA.send(CHAT_MESSAGE, { text: "tres" });
    const error = await errorPromise;

    expect(error.code).toBe(CHAT_RATE_LIMITED_ERROR);
    expect(typeof error.message).toBe("string");
    expect(room.state.chat).toHaveLength(2);
    expect([...room.state.chat].map((message) => message.text)).toEqual(["uno", "dos"]);
  });

  it("censura un término tóxico y marca el mensaje como filtrado", async () => {
    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const clientA = await colyseus.connectTo(room);

    const patch = clientA.waitForNextPatch();
    clientA.send(CHAT_MESSAGE, { text: "eres un tonto" });
    await patch;

    const message = room.state.chat.at(-1);
    expect(message?.filtered).toBe(true);
    expect(message?.text).toBe("eres un *****");
    expect(message?.text).not.toContain("tonto");
  });

  it("rechaza un payload inválido (vacío o demasiado largo)", async () => {
    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const clientA = await colyseus.connectTo(room);

    const emptyError = clientA.waitForMessage(ERROR_MESSAGE);
    clientA.send(CHAT_MESSAGE, { text: "" });
    expect((await emptyError).code).toBe(CHAT_INVALID_PAYLOAD_ERROR);

    const longError = clientA.waitForMessage(ERROR_MESSAGE);
    clientA.send(CHAT_MESSAGE, { text: "a".repeat(501) });
    expect((await longError).code).toBe(CHAT_INVALID_PAYLOAD_ERROR);

    expect(room.state.chat).toHaveLength(0);
  });
});
