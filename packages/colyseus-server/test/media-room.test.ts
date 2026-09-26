import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import {
  MEDIA_TOKEN_MESSAGE,
  MEDIA_TOKEN_REQUEST_MESSAGE,
  type MediaTokenPayload,
} from "../src/media/index";
import { CHAT_MEDIA_TEST_ROOM_NAME, ChatMediaTestRoom } from "./helpers/chat-media-test-room";
import { getFreePort } from "./helpers/free-port";

const MEDIA_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

let colyseus: ColyseusTestServer;

const config = defineConfig({
  initializeGameServer: (server) => {
    server.define(CHAT_MEDIA_TEST_ROOM_NAME, ChatMediaTestRoom);
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

beforeEach(() => {
  for (const key of MEDIA_KEYS) {
    delete process.env[key];
  }
});

/** Vista estructural mínima del cliente de test (evita acoplar el genérico de la Room). */
interface MediaTestClient {
  sessionId: string;
  send: (type: string, payload?: unknown) => void;
  waitForMessage: (type: string) => Promise<MediaTokenPayload>;
}

/** Pide el token de medios y espera el payload del servidor. */
async function requestMediaToken(
  client: MediaTestClient,
  options: Record<string, unknown> = {},
): Promise<MediaTokenPayload> {
  const message = client.waitForMessage(MEDIA_TOKEN_MESSAGE);
  client.send(MEDIA_TOKEN_REQUEST_MESSAGE, options);
  return message;
}

describe("media en la room (integración con @colyseus/testing)", () => {
  it("sin claves envía configured:false sin romper el join", async () => {
    const room = await colyseus.createRoom<ChatMediaTestRoom>(CHAT_MEDIA_TEST_ROOM_NAME, {});
    const client = await colyseus.connectTo(room);

    const payload = await requestMediaToken(client);
    expect(payload.configured).toBe(false);
    expect(payload.token).toBeNull();
    expect(payload.url).toBeNull();
    expect(payload.room).toBeNull();
    expect(payload.identity).toBe(client.sessionId);
    // La partida sigue viva: el jugador está en el estado.
    expect(room.state.players.has(client.sessionId)).toBe(true);
  });

  it("con claves firma un token y deriva la room del roomId", async () => {
    process.env.LIVEKIT_URL = "ws://localhost:7880";
    process.env.LIVEKIT_API_KEY = "devkey";
    process.env.LIVEKIT_API_SECRET = "secret";

    const room = await colyseus.createRoom<ChatMediaTestRoom>(CHAT_MEDIA_TEST_ROOM_NAME, {});
    const client = await colyseus.connectTo(room);

    const payload = await requestMediaToken(client);
    expect(payload.configured).toBe(true);
    expect(payload.token).toBeTruthy();
    expect(payload.room).toBe(`escape-${room.roomId}`);
    expect(payload.identity).toBe(client.sessionId);
    expect(payload.canPublish).toBe(true);
  });

  it("C-3: `role`/`name` del payload se ignoran — la room de test no tiene observadores", async () => {
    process.env.LIVEKIT_URL = "ws://localhost:7880";
    process.env.LIVEKIT_API_KEY = "devkey";
    process.env.LIVEKIT_API_SECRET = "secret";

    const room = await colyseus.createRoom<ChatMediaTestRoom>(CHAT_MEDIA_TEST_ROOM_NAME, {});
    // La room de test no lee `name` del join (siempre «Jugador N»): el nombre
    // servidor-autoritativo del token de medios es ese, nunca el del payload.
    const client = await colyseus.connectTo(room, { name: "Ana" });
    const serverName = room.state.players.get(client.sessionId)!.name;

    // Un cliente que se declara observador (o con otro nombre) sigue recibiendo
    // el rol/nombre reales que decide el servidor: nunca los del payload.
    const payload = await requestMediaToken(client, { role: "observer", name: "Suplantado" });
    expect(payload.role).toBe("player");
    expect(payload.canPublish).toBe(true);
    expect(payload.identity).toBe(client.sessionId);

    const segment = payload.token!.split(".")[1]!;
    const claims = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as {
      name?: string;
      video: { canPublish?: boolean; canSubscribe?: boolean };
    };
    expect(claims.name).toBe(serverName);
    expect(claims.video.canPublish).toBe(true);
    expect(claims.video.canSubscribe).toBe(true);
  });

  it("C-3: `allowVideo` del cliente solo puede rebajar la política, nunca subirla", async () => {
    process.env.LIVEKIT_URL = "ws://localhost:7880";
    process.env.LIVEKIT_API_KEY = "devkey";
    process.env.LIVEKIT_API_SECRET = "secret";
    process.env.LIVEKIT_ALLOW_VIDEO = "false";
    try {
      const room = await colyseus.createRoom<ChatMediaTestRoom>(CHAT_MEDIA_TEST_ROOM_NAME, {});
      const client = await colyseus.connectTo(room);

      // La política del servidor es `false`; pedir `true` no la sube.
      const payload = await requestMediaToken(client, { allowVideo: true });
      expect(payload.allowVideo).toBe(false);
      expect(payload.canPublishVideo).toBe(false);
    } finally {
      delete process.env.LIVEKIT_ALLOW_VIDEO;
    }
  });
});
