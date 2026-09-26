/**
 * Constantes compartidas del servidor de salas.
 *
 * El puerto por defecto es 2567 (el estándar de Colyseus). El rango 4000–4011
 * está reservado al operador, así que nunca se usa aquí.
 */

/** Puerto por defecto del servidor Colyseus. */
export const DEFAULT_PORT = 2567;

/** Aforo por defecto de una room (`GameRoom`). */
export const MAX_PLAYERS = 8;

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
 * C-2 (auditoría 2026-09-24, ajuste de producto): mientras la partida está en
 * el lobby (aún sin empezar), un desconectado libera su plaza a los 60 s —no
 * hay nada que perder y así no queda un cupo fantasma bloqueado.
 */
export const LOBBY_RECONNECT_GRACE_SEC = 60;

/**
 * C-2: en juego (`playing`), la plaza —posición, inventario, `characterId`—
 * se reserva hasta que la partida termina, no solo 60 s: quien vuelve
 * recupera exactamente su jugador. El papel de **anfitrión**, en cambio, se
 * reasigna a los `HOST_REASSIGN_GRACE_SEC` para no bloquear al resto del
 * grupo; si el anfitrión original vuelve más tarde (antes del fin), recupera
 * el puesto y el provisional lo pierde.
 */
export const HOST_REASSIGN_GRACE_SEC = 60;

/**
 * Fin de partida y cierre (specs/11 §8.1): tras `game_ended` ya no se admite
 * ninguna reconexión (los tokens de plaza/reconexión dejan de servir para
 * esta room) y la room se mantiene este margen para que todos vean la
 * pantalla de resultados antes de desconectar a todos y destruirse.
 */
export const RESULTS_ROOM_LIFETIME_SEC = 5 * 60;

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

/** Códigos de error de protocolo de la `GameRoom` (specs/11 §7). */
export const GAME_ERRORS = {
  notAvailable: "NOT_AVAILABLE",
  invalidState: "INVALID_STATE",
  permissionDenied: "PERMISSION_DENIED",
  moveTooFast: "MOVE_TOO_FAST",
  roomLocked: "ROOM_LOCKED",
} as const;

/** Room temporal del playtest del editor (ticket 3.8, specs/09 §3). */
export const PLAYTEST_ROOM_NAME = "playtest" as const;

/** Código de cierre del WebSocket cuando el playtest caduca con jugadores dentro. */
export const PLAYTEST_EXPIRED_CLOSE_CODE = 4410;

/**
 * Room de una sesión de evento (ticket 5.8): `GameRoom` a la que solo se entra
 * con el `joinToken` del canje (`POST /api/access-keys/redeem`).
 */
export const EVENT_ROOM_NAME = "event" as const;

/**
 * Observadores simultáneos por room de evento (ticket 5.9): el organizador
 * (y quien comparta su panel en otra pestaña) sin ocupar plazas de juego.
 */
export const MAX_EVENT_SPECTATORS = 4;

/** Ruta interna (web → Colyseus) para registrar un playtest. */
export const PLAYTEST_INTERNAL_PATH = "/internal/playtests" as const;
