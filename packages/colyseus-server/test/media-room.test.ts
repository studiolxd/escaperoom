import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import defineConfig from "@colyseus/tools";
import { LOBBY_ROOM_NAME } from "../src/constants";
import {
  MEDIA_TOKEN_MESSAGE,
  MEDIA_TOKEN_REQUEST_MESSAGE,
  type MediaTokenPayload,
} from "../src/media/index";
import { LobbyTestRoom } from "../src/rooms/lobby-test-room";
import { getFreePort } from "./helpers/free-port";

const MEDIA_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

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
    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
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

    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const client = await colyseus.connectTo(room);

    const payload = await requestMediaToken(client);
    expect(payload.configured).toBe(true);
    expect(payload.token).toBeTruthy();
    expect(payload.room).toBe(`escape-${room.roomId}`);
    expect(payload.identity).toBe(client.sessionId);
    expect(payload.canPublish).toBe(true);
  });

  it("el observador recibe un token de solo suscripción", async () => {
    process.env.LIVEKIT_URL = "ws://localhost:7880";
    process.env.LIVEKIT_API_KEY = "devkey";
    process.env.LIVEKIT_API_SECRET = "secret";

    const room = await colyseus.createRoom<LobbyTestRoom>(LOBBY_ROOM_NAME, {});
    const client = await colyseus.connectTo(room, { role: "observer" });

    const payload = await requestMediaToken(client, { role: "observer" });
    expect(payload.role).toBe("observer");
    expect(payload.canPublish).toBe(false);
    expect(payload.canPublishVideo).toBe(false);

    const segment = payload.token!.split(".")[1]!;
    const claims = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as {
      video: { canPublish?: boolean; canSubscribe?: boolean };
    };
    expect(claims.video.canPublish).toBe(false);
    expect(claims.video.canSubscribe).toBe(true);
  });
});
