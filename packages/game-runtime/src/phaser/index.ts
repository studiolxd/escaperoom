/**
 * Runtime Phaser del juego (modo play): escena isométrica con primitivas,
 * depth-sort, cámara por habitación y control de cambio de subroom.
 *
 * Este subpath arrastra Phaser; el loader puro vive en
 * `@escaperoom/game-runtime` (`.` y `./loader`).
 */
export * from "./iso";
export * from "./palette";
export * from "./room-scene";
export * from "./room-runtime";
