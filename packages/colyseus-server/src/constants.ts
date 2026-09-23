/**
 * Constantes compartidas del servidor de salas.
 *
 * El puerto por defecto es 2567 (el estándar de Colyseus). El rango 4000–4011
 * está reservado al operador, así que nunca se usa aquí.
 */

/** Nombre de la room de prueba del ticket 0.5 (specs/11 §3–4). */
export const LOBBY_ROOM_NAME = "lobby_test" as const;

/** Puerto por defecto del servidor Colyseus. */
export const DEFAULT_PORT = 2567;

/**
 * Distancia máxima, en celdas, que un jugador puede desplazarse por tick
 * (anti-teletransporte). El cliente envía pasos de como mucho este tamaño.
 */
export const MAX_STEP_PER_TICK = 0.5;

/** Cadencia del bucle de simulación autoritativo, en milisegundos (20 Hz). */
export const TICK_RATE_MS = 50;

/** Aforo de la room de prueba. */
export const MAX_PLAYERS = 8;

/** Límites del grid isométrico de prueba (celdas, origen arriba-izquierda). */
export const WORLD_BOUNDS = { minX: 0, minY: 0, maxX: 9, maxY: 9 } as const;

/** Paleta de tintado asignada por orden de entrada (specs/04 §2: tint por color). */
export const PLAYER_TINTS = [
  "#38bdf8",
  "#f472b6",
  "#facc15",
  "#4ade80",
  "#a78bfa",
  "#fb923c",
  "#22d3ee",
  "#f87171",
] as const;

/** Mensaje cliente → servidor con la posición deseada (specs/11 §4.2). */
export const MOVE_MESSAGE = "move" as const;

/** Mensaje servidor → cliente para rechazos de protocolo (specs/11 §7). */
export const ERROR_MESSAGE = "error" as const;

/**
 * El chat reutiliza el contrato de `@escaperoom/shared/chat` (specs/11 §4.4):
 * así el servidor y el cliente comparten longitud, rate limit, ventana e ids de
 * mensaje. Se reexportan para que el resto del servidor no dependa del subpath.
 */
export {
  CHAT_HISTORY_LIMIT,
  CHAT_INVALID_PAYLOAD_ERROR,
  CHAT_MAX_LENGTH,
  CHAT_MESSAGE,
  CHAT_RATE_LIMITED_ERROR,
} from "@escaperoom/shared/chat";

/** Nombre de la room de partida (specs/11 §1: `GameRoom`, ticket 2.8). */
export const GAME_ROOM_NAME = "game" as const;

/** Cadencia del reloj de la partida (timers, `delay`, avisos), en milisegundos. */
export const GAME_TICK_MS = 250;

/** Límite de la partida por defecto, en segundos (el cronómetro lo fijan las reglas). */
export const GAME_TIME_LIMIT_SEC = 3600;

/** Salto máximo por mensaje `move` en partida (specs/11 §9: 3 celdas/tick). */
export const GAME_MAX_STEP = 3;

/** Distancia máxima, en celdas, a una puerta abierta para cruzar a otra habitación. */
export const GAME_DOOR_REACH = 2;

/**
 * Mensajes de la `GameRoom` (specs/11 §4–6). Cliente → servidor: comandos; el
 * servidor responde al emisor (`attempt_result`, `puzzle_view`,
 * `split_fragments`, `hint_delivered`, `error`) o difunde a todos
 * (`dialog_show`, `object_state_changed`, `item_granted`, `puzzle_solved`,
 * `game_ended`).
 */
export const GAME_MESSAGES = {
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
  // Servidor → cliente
  puzzleView: "puzzle_view",
  attemptResult: "attempt_result",
  splitFragments: "split_fragments",
  hintDelivered: "hint_delivered",
  dialogShow: "dialog_show",
  objectStateChanged: "object_state_changed",
  itemGranted: "item_granted",
  puzzleSolved: "puzzle_solved",
  gameEnded: "game_ended",
} as const;

/** Códigos de error de protocolo de la `GameRoom` (specs/11 §7). */
export const GAME_ERRORS = {
  notAvailable: "NOT_AVAILABLE",
  invalidState: "INVALID_STATE",
  permissionDenied: "PERMISSION_DENIED",
  moveTooFast: "MOVE_TOO_FAST",
  roomLocked: "ROOM_LOCKED",
} as const;
