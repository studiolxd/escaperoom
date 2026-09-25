/**
 * Protocolo de la `GameRoom` (specs/11 §4–7) visto desde el cliente. Es un
 * **espejo** de las constantes de `@escaperoom/colyseus-server` (`GAME_MESSAGES`,
 * `GAME_ERRORS`…): el runtime no puede importar el servidor (arrastraría
 * Colyseus, LiveKit y Express al bundle del navegador). Un test de `web`, que
 * sí tiene el servidor como devDependency, comprueba que no divergen.
 */

/** Room de una partida publicada (`GAME_ROOM_NAME`). */
export const GAME_ROOM = "game" as const;

/** Room temporal del playtest del editor (`PLAYTEST_ROOM_NAME`, ticket 3.8). */
export const PLAYTEST_ROOM = "playtest" as const;

/**
 * Room de una sesión de evento (`EVENT_ROOM_NAME`, ticket 5.8): se entra con
 * `{ sessionId, joinToken }` tras el canje (`POST /api/access-keys/redeem`).
 */
export const EVENT_ROOM = "event" as const;

/** Cierre del WebSocket cuando el playtest caduca (`PLAYTEST_EXPIRED_CLOSE_CODE`). */
export const PLAYTEST_EXPIRED_CLOSE = 4410;

/** Mensajes de la `GameRoom` (`GAME_MESSAGES` del servidor). */
export const GAME_PROTOCOL = {
  startGame: "start_game",
  move: "move",
  interact: "interact",
  useItem: "use_item",
  combine: "combine",
  puzzleOpen: "puzzle_open",
  puzzleClose: "puzzle_close",
  puzzleAttempt: "puzzle_attempt",
  plateState: "plate_state",
  splitView: "split_view",
  hintRequest: "hint_request",
  /** Elegir/cambiar de personaje ya dentro de la sala (lobby, A1/specs/19). */
  selectCharacter: "select_character",
  // Servidor → cliente
  puzzleView: "puzzle_view",
  attemptResult: "attempt_result",
  splitFragments: "split_fragments",
  hintDelivered: "hint_delivered",
  dialogShow: "dialog_show",
  imageShow: "image_show",
  objectStateChanged: "object_state_changed",
  itemGranted: "item_granted",
  puzzleSolved: "puzzle_solved",
  gameEnded: "game_ended",
} as const;

/** Rechazos de protocolo (`GAME_ERRORS` del servidor, specs/11 §7). */
export const GAME_PROTOCOL_ERRORS = {
  notAvailable: "NOT_AVAILABLE",
  invalidState: "INVALID_STATE",
  permissionDenied: "PERMISSION_DENIED",
  moveTooFast: "MOVE_TOO_FAST",
  roomLocked: "ROOM_LOCKED",
} as const;

/** Movimiento fuera del grid (`OUT_OF_BOUNDS` de `movement.ts`). */
export const MOVE_OUT_OF_BOUNDS = "OUT_OF_BOUNDS" as const;

/** Mensaje de rechazo servidor → cliente (`ERROR_MESSAGE`). */
export const PROTOCOL_ERROR_MESSAGE = "error" as const;

/** Chat de la room (`CHAT_MESSAGE` de `@escaperoom/shared/chat`). */
export const CHAT_PROTOCOL_MESSAGE = "chat" as const;

/** Medios (specs/11 §8): petición y respuesta del token LiveKit. */
export const MEDIA_PROTOCOL = {
  request: "request_media_token",
  token: "media_token",
} as const;

/**
 * Salto máximo aceptado por mensaje `move` (`GAME_MAX_STEP`). El cliente
 * trocea los desplazamientos largos en pasos algo menores.
 */
export const GAME_MAX_STEP_CELLS = 3;
