import { readMediaConfig, type MediaEnv } from "./config.js";
import { MEDIA_TOKEN_MESSAGE } from "./constants.js";
import { parseMediaJoinOptions } from "./join-options.js";
import { deriveLiveKitRoomName } from "./room-name.js";
import { signLiveKitToken, type MediaRole } from "./token.js";

/**
 * Payload de `media_token` (specs/11 §8): lo que el cliente necesita para
 * conectar a LiveKit, o para saber que no hay medios. Nunca contiene secretos:
 * el token es de corta vida y está firmado, y la API secret jamás sale del
 * servidor.
 */
export interface MediaTokenPayload {
  /** `true` si el servidor tiene claves y firmó token. */
  configured: boolean;
  token: string | null;
  url: string | null;
  /** Nombre de la room de LiveKit (`escape-<roomId>`). */
  room: string | null;
  identity: string;
  role: MediaRole;
  allowVideo: boolean;
  canPublish: boolean;
  canPublishVideo: boolean;
}

export interface ResolveMediaTokenInput {
  identity: string;
  gameRoomId: string;
  role: MediaRole;
  /** Si falta, se usa `LIVEKIT_ALLOW_VIDEO` (default `true`, fila B2C). */
  allowVideo?: boolean;
  name?: string;
  env?: MediaEnv;
}

/**
 * Resuelve el payload de medios para un join. Si no hay claves devuelve
 * `{configured: false, token: null, url: null}` y la partida sigue por Colyseus
 * sin voz ni webcam (degradación limpia, ticket 2.2).
 */
export async function resolveMediaToken(input: ResolveMediaTokenInput): Promise<MediaTokenPayload> {
  const config = readMediaConfig(input.env ?? process.env);

  if (!config) {
    return {
      configured: false,
      token: null,
      url: null,
      room: null,
      identity: input.identity,
      role: input.role,
      allowVideo: false,
      canPublish: false,
      canPublishVideo: false,
    };
  }

  const allowVideo = input.allowVideo ?? config.allowVideoByDefault;
  const token = await signLiveKitToken(
    {
      identity: input.identity,
      gameRoomId: input.gameRoomId,
      role: input.role,
      allowVideo,
      name: input.name,
    },
    config,
  );

  return {
    configured: token !== null,
    token,
    url: config.url,
    room: deriveLiveKitRoomName(input.gameRoomId, config.roomPrefix),
    identity: input.identity,
    role: input.role,
    allowVideo,
    canPublish: input.role === "player",
    canPublishVideo: input.role === "player" && allowVideo,
  };
}

/** Vista mínima de un cliente Colyseus que puede recibir el `media_token`. */
export interface MediaTokenClient {
  sessionId: string;
  send: (type: string, payload: MediaTokenPayload) => void;
}

/**
 * Política de medios que decide el servidor (C-3): `role`/`name` siempre
 * vienen de aquí, nunca del payload del cliente (suplantación: nombre ajeno
 * u observador que se declara jugador). `allowVideo` es un TECHO, no un
 * valor: el cliente solo puede rebajarlo a `false` (contexto educativo, un
 * jugador que no quiere cámara); `undefined` deja que `resolveMediaToken` use
 * `LIVEKIT_ALLOW_VIDEO`.
 */
export interface ServerMediaPolicy {
  role: MediaRole;
  name?: string;
  allowVideo?: boolean;
}

/**
 * Punto de entrada reutilizable por cualquier room: resuelve el token con la
 * política del servidor y lo envía al cliente. El payload del cliente
 * (`options`) solo puede rebajar `allowVideo`; el resto se ignora.
 */
export async function sendMediaTokenToClient(
  client: MediaTokenClient,
  gameRoomId: string,
  options: unknown,
  server: ServerMediaPolicy,
): Promise<MediaTokenPayload> {
  const { allowVideo: requestedAllowVideo } = parseMediaJoinOptions(options);
  const payload = await resolveMediaToken({
    identity: client.sessionId,
    gameRoomId,
    role: server.role,
    name: server.name,
    allowVideo: requestedAllowVideo === false ? false : server.allowVideo,
  });
  client.send(MEDIA_TOKEN_MESSAGE, payload);
  return payload;
}
