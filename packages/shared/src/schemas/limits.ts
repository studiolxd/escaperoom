/**
 * Topes de tamaño del formato RoomPackage (auditoría 2026-09-24, hallazgos
 * D-1/D-2/D-11): constantes con nombre en un único sitio para que esquemas
 * Zod, motor, editor y MCP compartan el mismo límite y no se pueda tumbar el
 * event loop ni reventar la pila con un paquete hostil (`players.max` enorme,
 * rejillas gigantes, arrays sin tope, `delay` anidado sin fondo…).
 */

/**
 * Techo absoluto de `maxPlayersPerRoom`: la paleta de tintes de jugador de
 * colyseus-server tiene 8 colores; por encima se repetirían.
 */
export const MAX_PLAYERS_PER_ROOM_CEILING = 8;

/** `cols`/`rows` máximos de cualquier `GridSchema` (mapa, sliding_puzzle, pipes). */
export const MAX_GRID_DIMENSION = 256;

/**
 * Tope genérico para arrays "de contenido" del formato (objetos, pares,
 * recetas, fragmentos…). 1000 deja margen de sobra sobre cualquier sala real
 * (el Rey Aldric tiene 28 objetos; un test de "sala grande" del MCP construye
 * una de 628) sin dejar de acotar el coste de validarla.
 */
export const MAX_CONTENT_ARRAY_ITEMS = 1000;

/** Tope genérico para strings libres del formato (textos, ids, código…). */
export const MAX_CONTENT_STRING_LENGTH = 10_000;

/** Entradas máximas de una capa de tilemap en RLE (`[cantidad, tileId, …]`). */
export const MAX_RLE_ENTRIES = 20_000;

/** `playerCounts` máximos que puede pedir a la vez `validate`/`create_room` del MCP. */
export const MAX_VALIDATE_PLAYER_COUNTS = MAX_PLAYERS_PER_ROOM_CEILING;

/** Duración mínima (segundos) de `start_timer`: evita timers periódicos que disparan sin fin. */
export const MIN_TIMER_DURATION_SEC = 1;

/** Tope de eventos `on_timer`/`on_timer_end` que un solo tick del motor puede generar. */
export const MAX_TIMER_EVENTS_PER_TICK = 1000;

/** Profundidad máxima de anidado de acciones `delay`. */
export const MAX_DELAY_DEPTH = 4;

/** Acciones máximas por lista (`rule.actions` o `delay.actions`) en cada nivel. */
export const MAX_ACTIONS_PER_LIST = 64;

/** Puntos de vista de `split_clue` a partir de los cuales el oráculo deja de buscar subconjuntos exhaustivamente. */
export const MAX_SPLIT_CLUE_VIEWPOINTS_FOR_SUBSET = 12;

/**
 * Duración de partida (`meta.timeLimitMinutes`, ticket duración-salas) para
 * salas publicadas ANTES de este campo (retrocompatibilidad): el límite fijo
 * que ya tenían todas las salas (`GAME_TIME_LIMIT_SEC` de `colyseus-server`,
 * 1 h). Solo se usa cuando el campo falta del `RoomPackage` — un paquete
 * nuevo declara `null` explícitamente para "sin duración", nunca lo omite
 * para conseguir el mismo efecto.
 */
export const DEFAULT_ROOM_TIME_LIMIT_MINUTES = 60;
