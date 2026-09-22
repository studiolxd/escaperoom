/**
 * Esquemas Zod compartidos (specs/08). Contrato declarativo `RoomPackage` y sus
 * piezas (`map`, `objects`, `items`, `puzzles`, `rules`, `dialogs`, `hints`).
 *
 * `PACKAGE_FORMAT` se conserva como valor propuesto para `meta.packageFormat`;
 * el schema solo exige su presencia (specs/08 §6, decisión abierta).
 */
export * from "./common";
export * from "./world";
export * from "./puzzle";
export * from "./rules";
export * from "./roompackage";
export * from "./errors";
