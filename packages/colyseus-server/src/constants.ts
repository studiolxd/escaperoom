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
