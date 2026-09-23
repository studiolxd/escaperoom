/**
 * Fuente de estado de la partida (fase 2): interfaz `GameClient` con dos
 * implementaciones intercambiables —red (`GameRoom`/`PlaytestRoom` de
 * Colyseus) y local (`RoomSession` en proceso)— y las proyecciones puras que
 * consume la UI. Puro: sin Phaser ni SDK de Colyseus.
 */
export * from "./protocol";
export * from "./types";
export * from "./snapshot";
export * from "./network";
export * from "./local";
export * from "./views";
