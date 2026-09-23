/**
 * Parte headless del inspector (sin React): generador de formularios desde los
 * esquemas Zod, mapa de referencias entre ids, renombrado atómico y lectura /
 * escritura de propiedades. Apta para el servidor y el MCP vía
 * `@escaperoom/editor/inspector`.
 */
export * from "./target";
export * from "./references";
export * from "./schema-form";
export * from "./rename";
export * from "./inspector-model";
export * from "./labels";
