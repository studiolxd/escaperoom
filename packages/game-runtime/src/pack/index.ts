/**
 * Pack gráfico (specs/26): esquema Zod del manifiesto, resolución de frames por
 * nombre, colisiones por celda y manifiesto sintético de placeholder.
 *
 * Todo este subpath es puro (sin Phaser ni Node), así que se puede importar en
 * tests, en el servidor y en el navegador. La carga de atlas y la generación de
 * texturas placeholder viven en `@escaperoom/game-runtime/phaser`; las
 * herramientas de empaquetado, en `scripts/build-pack.ts`.
 */
export * from "./manifest";
export * from "./frames";
export * from "./collisions";
export * from "./placeholder";
export * from "./avatar";
export * from "./validate";
