/**
 * Runtime del juego (Phaser). Placeholder del ticket 0.1: el canvas híbrido
 * llega en el ticket 0.4 y el tilemap en el 1.2.
 */
export const RUNTIME_MODE = { play: "play", edit: "edit" } as const;
export type RuntimeMode = (typeof RUNTIME_MODE)[keyof typeof RUNTIME_MODE];
