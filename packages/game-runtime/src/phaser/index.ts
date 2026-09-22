/**
 * Runtime Phaser del juego (modo play): escena isométrica con el tilemap real
 * del pack (o placeholders automáticos), depth-sort, colisiones por celda,
 * avatar animado, cámara por habitación y control de cambio de subroom.
 *
 * Este subpath arrastra Phaser; el loader puro y el módulo de pack viven en
 * `@escaperoom/game-runtime` (`.`), `./loader` y `./pack`.
 */
export * from "./iso";
export * from "./palette";
export * from "./pack-textures";
export * from "./avatar";
export * from "./world-events";
export * from "./room-scene";
export * from "./room-runtime";
