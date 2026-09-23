/**
 * Parte headless de la sala en el doc Yjs (sin React): apta para el servidor
 * (validate, publish, MCP) vía `@escaperoom/editor/room-doc`.
 */
export * from "./tiles";
export * from "./doc-model";
export * from "./serialize";
export * from "./commands";
export * from "./content";
export * from "./tool-controller";
/** Errores de idiomas que pueden lanzar `writeRoomMeta` y los comandos de contenido. */
export { RoomLanguageError } from "../i18n-fields/room-languages";
