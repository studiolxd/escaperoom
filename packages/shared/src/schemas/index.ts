/**
 * Esquemas Zod compartidos (specs/08). Contrato declarativo `RoomPackage` y sus
 * piezas (`map`, `objects`, `items`, `puzzles`, `rules`, `dialogs`, `hints`).
 *
 * `PACKAGE_FORMAT` es el valor canónico de `meta.packageFormat`
 * (`"roompackage/v1"`); el schema solo exige su presencia, la validación del
 * literal exacto vive en `SUPPORTED_PACKAGE_FORMATS` (specs/08 §6).
 */
export * from "./common";
export * from "./localized-text";
export * from "./world";
export * from "./puzzle";
export * from "./rules";
export * from "./roompackage";
export * from "./analytics";
export * from "./errors";
