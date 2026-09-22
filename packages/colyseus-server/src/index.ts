/**
 * Servidor autoritativo de salas (Colyseus). El ticket 0.5 añade la room
 * `lobby_test` con movimiento validado; el motor de reglas llega en el 1.4.
 */
export {
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
export { LobbyTestRoom } from "./rooms/lobby-test-room.js";
export { LobbyState, PlayerState } from "./schema/lobby-state.js";
export { createGameServer, resolvePort, startGameServer } from "./server.js";
export { pickPlayerTint } from "./tints.js";
