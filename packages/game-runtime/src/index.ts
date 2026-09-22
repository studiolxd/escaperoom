/**
 * Runtime del juego (modo play). El índice solo reexporta lo puro (loader del
 * `RoomPackage` y modos) para no arrastrar Phaser a cualquier bundle; la escena
 * isométrica se importa por el subpath `@escaperoom/game-runtime/phaser`.
 */
export const RUNTIME_MODE = { play: "play", edit: "edit" } as const;
export type RuntimeMode = (typeof RUNTIME_MODE)[keyof typeof RUNTIME_MODE];

export * from "./loader";
export * from "./pack";
