/**
 * Parte headless del validador del editor (sin React): apta para el servidor
 * (`POST /api/rooms/:roomId/validate`) vía `@escaperoom/editor/validation`.
 */
export * from "./serializer";
export * from "./findings";
export * from "./controller";
export * from "./labels";
