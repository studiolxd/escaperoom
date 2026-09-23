import { describe, expect, it } from "vitest";
import { TrackSource } from "livekit-server-sdk";
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  deriveLiveKitRoomName,
  gameRoomIdFromLiveKitRoomName,
  isMediaConfigured,
  mediaPermissionsForRole,
  parseMediaJoinOptions,
  readMediaConfig,
  resolveMediaToken,
  signLiveKitToken,
} from "../src/media/index";

/** Claves de juguete para los tests: firman y verifican sin infraestructura. */
const TEST_ENV = {
  LIVEKIT_URL: "ws://localhost:7880",
  LIVEKIT_API_KEY: "devkey",
  LIVEKIT_API_SECRET: "secret",
} as const;

interface DecodedJwt {
  iss: string;
  sub: string;
  nbf: number;
  exp: number;
  iat?: number;
  video: {
    roomJoin?: boolean;
    room?: string;
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishData?: boolean;
    canPublishSources?: string[];
  };
}

/** Decodifica el payload del JWT (sin verificar firma; los claims son el objeto de test). */
function decodeJwt(token: string): DecodedJwt {
  const segment = token.split(".")[1];
  if (!segment) {
    throw new Error("JWT sin payload");
  }
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as DecodedJwt;
}

describe("media · config", () => {
  it("queda desactivado y no lanza si faltan claves", () => {
    expect(readMediaConfig({})).toBeNull();
    expect(isMediaConfigured({})).toBe(false);
    // Con solo parte de las credenciales tampoco se activa.
    expect(isMediaConfigured({ LIVEKIT_URL: TEST_ENV.LIVEKIT_URL })).toBe(false);
    expect(
      isMediaConfigured({
        LIVEKIT_URL: TEST_ENV.LIVEKIT_URL,
        LIVEKIT_API_KEY: TEST_ENV.LIVEKIT_API_KEY,
      }),
    ).toBe(false);
  });

  it("aplica defaults y overrides de entorno", () => {
    const config = readMediaConfig({
      ...TEST_ENV,
      LIVEKIT_ROOM_PREFIX: "  mi-evento  ",
      LIVEKIT_TOKEN_TTL_SECONDS: "120",
      LIVEKIT_ALLOW_VIDEO: "false",
    });
    expect(config).not.toBeNull();
    expect(config?.roomPrefix).toBe("mi-evento");
    expect(config?.tokenTtlSeconds).toBe(120);
    expect(config?.allowVideoByDefault).toBe(false);

    const defaults = readMediaConfig(TEST_ENV);
    expect(defaults?.tokenTtlSeconds).toBe(DEFAULT_TOKEN_TTL_SECONDS);
    expect(defaults?.allowVideoByDefault).toBe(true);
  });
});

describe("media · derivación sala ↔ room", () => {
  it("deriva el nombre de room desde el id de la GameRoom", () => {
    expect(deriveLiveKitRoomName("abc123")).toBe("escape-abc123");
    expect(deriveLiveKitRoomName("abc123", "evento")).toBe("evento-abc123");
  });

  it("es determinista e inyectiva (ids distintos → rooms distintas)", () => {
    expect(deriveLiveKitRoomName("sala-a")).not.toBe(deriveLiveKitRoomName("sala-b"));
  });

  it("hace round-trip room → gameRoomId → room", () => {
    const name = deriveLiveKitRoomName("room-xyz");
    expect(gameRoomIdFromLiveKitRoomName(name)).toBe("room-xyz");
  });

  it("devuelve null si la room no lleva el prefijo", () => {
    expect(gameRoomIdFromLiveKitRoomName("otra-cosa")).toBeNull();
    expect(gameRoomIdFromLiveKitRoomName("escape-")).toBeNull();
  });

  it("exige un id no vacío", () => {
    expect(() => deriveLiveKitRoomName("   ")).toThrow();
  });
});

describe("media · permisos por rol", () => {
  it("el jugador publica audio y vídeo", () => {
    const permissions = mediaPermissionsForRole("player", true);
    expect(permissions.canPublish).toBe(true);
    expect(permissions.canPublishData).toBe(true);
    expect(permissions.canSubscribe).toBe(true);
    expect(permissions.canPublishSources).toContain(TrackSource.CAMERA);
    expect(permissions.canPublishSources).toContain(TrackSource.MICROPHONE);
  });

  it("el jugador sin vídeo solo publica micrófono (contexto educativo)", () => {
    const permissions = mediaPermissionsForRole("player", false);
    expect(permissions.canPublish).toBe(true);
    expect(permissions.canPublishSources).toEqual([TrackSource.MICROPHONE]);
  });

  it("el observador nunca publica (solo suscripción)", () => {
    const permissions = mediaPermissionsForRole("observer", true);
    expect(permissions.canPublish).toBe(false);
    expect(permissions.canPublishData).toBe(false);
    expect(permissions.canSubscribe).toBe(true);
    expect(permissions.canPublishSources).toBeUndefined();
  });
});

describe("media · firma de token", () => {
  it("firma un JWT con identidad, sala y permisos de jugador", async () => {
    const config = readMediaConfig(TEST_ENV);
    const token = await signLiveKitToken(
      {
        identity: "player-session-1",
        gameRoomId: "room-42",
        role: "player",
        allowVideo: true,
      },
      config,
    );
    expect(token).not.toBeNull();

    const claims = decodeJwt(token!);
    expect(claims.sub).toBe("player-session-1");
    expect(claims.iss).toBe("devkey");
    expect(claims.video.room).toBe("escape-room-42");
    expect(claims.video.roomJoin).toBe(true);
    expect(claims.video.canPublish).toBe(true);
    expect(claims.video.canSubscribe).toBe(true);
    expect(claims.video.canPublishData).toBe(true);
    expect(claims.video.canPublishSources).toEqual(["microphone", "camera"]);
  });

  it("firma al observador en solo-suscripción", async () => {
    const token = await signLiveKitToken(
      {
        identity: "observer-1",
        gameRoomId: "room-42",
        role: "observer",
        allowVideo: true,
      },
      readMediaConfig(TEST_ENV),
    );
    const claims = decodeJwt(token!);
    expect(claims.sub).toBe("observer-1");
    expect(claims.video.room).toBe("escape-room-42");
    expect(claims.video.canPublish).toBe(false);
    expect(claims.video.canPublishData).toBe(false);
    expect(claims.video.canSubscribe).toBe(true);
    expect(claims.video.canPublishSources).toBeUndefined();
  });

  it("respeta el TTL configurado", async () => {
    const token = await signLiveKitToken(
      {
        identity: "ttl-1",
        gameRoomId: "room-1",
        role: "player",
        allowVideo: false,
        ttlSeconds: 120,
      },
      readMediaConfig(TEST_ENV),
    );
    const claims = decodeJwt(token!);
    expect(claims.exp - claims.nbf).toBe(120);
  });

  it("no firma sin claves (degradación limpia)", async () => {
    const token = await signLiveKitToken(
      { identity: "x", gameRoomId: "room-1", role: "player", allowVideo: true },
      null,
    );
    expect(token).toBeNull();
  });
});

describe("media · payload de join", () => {
  it("sin claves devuelve configured:false y la partida sigue sin medios", async () => {
    const payload = await resolveMediaToken({
      identity: "p1",
      gameRoomId: "room-7",
      role: "player",
      env: {},
    });
    expect(payload.configured).toBe(false);
    expect(payload.token).toBeNull();
    expect(payload.url).toBeNull();
    expect(payload.room).toBeNull();
    expect(payload.canPublish).toBe(false);
    expect(payload.canPublishVideo).toBe(false);
  });

  it("con claves deriva la room e informa capacidades del jugador", async () => {
    const payload = await resolveMediaToken({
      identity: "p1",
      gameRoomId: "room-7",
      role: "player",
      env: TEST_ENV,
    });
    expect(payload.configured).toBe(true);
    expect(payload.room).toBe("escape-room-7");
    expect(payload.url).toBe("ws://localhost:7880");
    expect(payload.canPublish).toBe(true);
    expect(payload.canPublishVideo).toBe(true);

    const claims = decodeJwt(payload.token!);
    expect(claims.sub).toBe("p1");
    expect(claims.video.room).toBe("escape-room-7");
  });

  it("los medios del observador son de solo suscripción", async () => {
    const payload = await resolveMediaToken({
      identity: "obs",
      gameRoomId: "room-7",
      role: "observer",
      env: TEST_ENV,
    });
    expect(payload.canPublish).toBe(false);
    expect(payload.canPublishVideo).toBe(false);
    const claims = decodeJwt(payload.token!);
    expect(claims.video.canPublish).toBe(false);
    expect(claims.video.canSubscribe).toBe(true);
  });

  it("allowVideo:false desactiva la cámara aunque haya claves", async () => {
    const payload = await resolveMediaToken({
      identity: "p1",
      gameRoomId: "room-7",
      role: "player",
      allowVideo: false,
      env: TEST_ENV,
    });
    expect(payload.allowVideo).toBe(false);
    expect(payload.canPublishVideo).toBe(false);
    const claims = decodeJwt(payload.token!);
    expect(claims.video.canPublishSources).toEqual(["microphone"]);
  });
});

describe("media · opciones de join", () => {
  it("normaliza rol, allowVideo y nombre sin lanzar con payloads inválidos", () => {
    expect(parseMediaJoinOptions({ role: "observer", allowVideo: false, name: "Ana" })).toEqual({
      role: "observer",
      allowVideo: false,
      name: "Ana",
    });
    expect(parseMediaJoinOptions(undefined)).toEqual({
      role: "player",
      allowVideo: undefined,
      name: undefined,
    });
    expect(parseMediaJoinOptions({ role: "hacker", allowVideo: "yes", name: 42 })).toEqual({
      role: "player",
      allowVideo: undefined,
      name: undefined,
    });
  });
});
