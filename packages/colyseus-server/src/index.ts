/**
 * Servidor autoritativo de salas (Colyseus). El ticket 0.5 añade la room
 * `lobby_test` con movimiento validado; el motor de reglas llega en el 1.4.
 */
export {
  CHAT_HISTORY_LIMIT,
  CHAT_INVALID_PAYLOAD_ERROR,
  CHAT_MAX_LENGTH,
  CHAT_MESSAGE,
  CHAT_RATE_LIMITED_ERROR,
  DEFAULT_PORT,
  ERROR_MESSAGE,
  LOBBY_ROOM_NAME,
  MAX_PLAYERS,
  MAX_STEP_PER_TICK,
  MOVE_MESSAGE,
  PLAYER_TINTS,
  TICK_RATE_MS,
  WORLD_BOUNDS,
} from "./constants.js";
export {
  distance,
  isWithinBounds,
  MOVE_TOO_FAST,
  OUT_OF_BOUNDS,
  validateMove,
} from "./movement.js";
export type {
  MoveBounds,
  MoveErrorCode,
  MoveLimits,
  MoveValidationResult,
  Vector2,
} from "./movement.js";
export {
  DEFAULT_LIVEKIT_ROOM_PREFIX,
  DEFAULT_TOKEN_TTL_SECONDS,
  buildVideoGrant,
  deriveLiveKitRoomName,
  gameRoomIdFromLiveKitRoomName,
  isMediaConfigured,
  MEDIA_TOKEN_MESSAGE,
  MEDIA_TOKEN_REQUEST_MESSAGE,
  mediaPermissionsForRole,
  parseMediaJoinOptions,
  readMediaConfig,
  resolveMediaToken,
  sendMediaTokenToClient,
  signLiveKitToken,
} from "./media/index.js";
export type {
  MediaConfig,
  MediaJoinOptions,
  MediaPermissions,
  MediaRole,
  MediaTokenClient,
  MediaTokenInput,
  MediaTokenPayload,
} from "./media/index.js";
export { LobbyTestRoom } from "./rooms/lobby-test-room.js";
export { ChatMessageState, LobbyState, PlayerState } from "./schema/lobby-state.js";
export { createGameServer, resolvePort, startGameServer } from "./server.js";
export { pickPlayerTint } from "./tints.js";
