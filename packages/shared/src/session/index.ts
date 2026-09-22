/**
 * Fin de partida (specs/04 §6, ticket 1.9). Lógica pura sobre el `GameState`
 * del motor de reglas: normaliza el resultado, detecta el `timeout` del
 * cronómetro y proyecta las stats finales para la pantalla de resultados.
 */
export * from "./end-game";

/**
 * Sesión de sala (ticket 1.10): host puro que coordina motor de reglas,
 * plantillas de puzzle, pistas y fin de partida sin reimplementarlos. Lo usan
 * el test de integración de la Sala 1 y la página de playtest.
 */
export * from "./room-session";
