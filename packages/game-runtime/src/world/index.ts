/**
 * Sistema puro de objetos del mundo (specs/04 §3): estados y transiciones,
 * inventario interno (`distribution`) e inspección con diálogos localizados.
 *
 * Sin Phaser ni React: se puede importar en Node, en el navegador y en tests
 * sin infraestructura. La escena (`@escaperoom/game-runtime/phaser`) y el motor
 * de reglas de 1.4 lo consumen por separado.
 */
export * from "./types";
export * from "./state";
export * from "./distribution";
export * from "./inspection";
export * from "./selection";
export * from "./reactive";
