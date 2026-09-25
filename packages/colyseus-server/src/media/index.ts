/**
 * Módulo de medios (voz y webcam con LiveKit) del servidor autoritativo.
 *
 * Firma el token de join por `GameRoom` (specs/12 §1, specs/11 §8) y degrada a
 * "sin medios" si no hay credenciales. Independiente del motor de reglas y del
 * chat: cualquier room puede usarlo.
 */
export {
  DEFAULT_LIVEKIT_ROOM_PREFIX,
  DEFAULT_TOKEN_TTL_SECONDS,
  isMediaConfigured,
  readMediaConfig,
  type MediaConfig,
  type MediaEnv,
} from "./config.js";
export { MEDIA_TOKEN_MESSAGE, MEDIA_TOKEN_REQUEST_MESSAGE } from "./constants.js";
export { parseMediaJoinOptions, type MediaJoinOptions } from "./join-options.js";
export { deriveLiveKitRoomName, gameRoomIdFromLiveKitRoomName } from "./room-name.js";
export {
  resolveMediaToken,
  sendMediaTokenToClient,
  type MediaTokenClient,
  type MediaTokenPayload,
  type ResolveMediaTokenInput,
  type ServerMediaPolicy,
} from "./service.js";
export {
  buildVideoGrant,
  mediaPermissionsForRole,
  signLiveKitToken,
  type MediaPermissions,
  type MediaRole,
  type MediaTokenInput,
} from "./token.js";
