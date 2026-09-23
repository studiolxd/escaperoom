/**
 * Runtime del juego (modos play y edit). El índice solo reexporta lo puro (loader
 * del `RoomPackage`, modos, eventos y palette del modo edición) para no arrastrar Phaser a cualquier bundle; la escena
 * isométrica se importa por el subpath `@escaperoom/game-runtime/phaser`.
 */
export const RUNTIME_MODE = { play: "play", edit: "edit" } as const;
export type RuntimeMode = (typeof RUNTIME_MODE)[keyof typeof RUNTIME_MODE];

export * from "./loader";
export * from "./pack";
export * from "./world";
export * from "./edit";
