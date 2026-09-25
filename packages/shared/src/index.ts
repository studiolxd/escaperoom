// El índice solo reexporta lo puro (esquemas y motor de reglas). `services` y
// `db` (Prisma) se importan por su subpath (`@escaperoom/shared/services`,
// `/db`) para no arrastrar el cliente de base de datos a cualquier bundle.
// `session`, `validator` y `templates` no se reexportan aquí (D-28): sin
// consumidores del barrel raíz, solo arrastran código al bundle de quien
// importe cualquier otra cosa de `@escaperoom/shared`; quien los necesite usa
// su propio subpath (`@escaperoom/shared/session`, `/validator`, `/templates`).
export * from "./schemas";
export * from "./engine";
export * from "./hints";
export * from "./chat";
export * from "./exhaustive";
