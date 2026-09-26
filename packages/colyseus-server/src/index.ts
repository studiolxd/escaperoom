/**
 * Servidor autoritativo de salas (Colyseus): la room `game` que ejecuta la
 * partida completa (motor de reglas + 8 plantillas) sobre `RoomSession`
 * (ticket 2.8); el 3.8, la `playtest`; el 5.8, la `event` (sesión de evento
 * con `joinToken`).
 */
export {
  CHAT_HISTORY_LIMIT,
  CHAT_INVALID_PAYLOAD_ERROR,
  CHAT_MAX_LENGTH,
  CHAT_MESSAGE,
  CHAT_RATE_LIMITED_ERROR,
  DEFAULT_PORT,
  ERROR_MESSAGE,
  EVENT_ROOM_NAME,
  GAME_DOOR_REACH,
  GAME_ERRORS,
  GAME_MAX_STEP,
  GAME_MESSAGES,
  GAME_ROOM_NAME,
  GAME_TICK_MS,
  GAME_TIME_LIMIT_SEC,
  MAX_EVENT_SPECTATORS,
  MAX_PLAYERS,
  PLAYER_TINTS,
  PLAYTEST_EXPIRED_CLOSE_CODE,
  PLAYTEST_INTERNAL_PATH,
  PLAYTEST_ROOM_NAME,
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
export { GameRoom } from "./rooms/game-room.js";
export { PLAYTEST_FORBIDDEN_CODE, PlaytestRoom } from "./rooms/playtest-room.js";
export { EVENT_JOIN_FORBIDDEN_CODE, EventRoom, JOIN_TOKEN_ERRORS } from "./rooms/event-room.js";
export type { EventClientAuth, EventRoomMetadata, EventRoomOptions } from "./rooms/event-room.js";
export { createEventProgressRouter } from "./events/http.js";
export {
  configureEventRuntime,
  FIXTURE_EVENT_RUNTIME,
  getEventRuntime,
} from "./events/runtime.js";
export type { PlaytestJoinOptions, PlaytestRoomOptions } from "./rooms/playtest-room.js";
export {
  DEFAULT_PLAYTEST_TTL_SECONDS,
  DEV_PLAYTEST_SECRET,
  readPlaytestConfig,
} from "./playtest/config.js";
export type { PlaytestConfig } from "./playtest/config.js";
export { createPlaytestRouter } from "./playtest/http.js";
export type { PlaytestCreatedResponse } from "./playtest/http.js";
export {
  MAX_PLAYTESTS_PER_AUTHOR,
  PlaytestRegistry,
  playtestRegistry,
} from "./playtest/registry.js";
export type { PlaytestEntry } from "./playtest/registry.js";
export { signPlaytestToken, verifyPlaytestToken } from "./playtest/token.js";
export type { PlaytestTokenPayload, PlaytestTokenResult } from "./playtest/token.js";
export type {
  GameJoinOptions,
  GameMilestone,
  GameMilestoneClock,
  GameRoomOptions,
} from "./rooms/game-room.js";
export {
  GameInventoryState,
  GamePlayerState,
  GamePuzzleState,
  GameRoomState,
} from "./schema/game-state.js";
export {
  loadReyAldricRoomPackage,
  resolveRoomPackage,
  REY_ALDRIC_PACKAGE_ID,
} from "./game/room-packages.js";
export { ChatMessageState } from "./schema/lobby-state.js";
export {
  createGameServer,
  defineEventRoom,
  definePlaytestRoom,
  resolvePort,
  startGameServer,
} from "./server.js";
export { pickPlayerTint } from "./tints.js";
