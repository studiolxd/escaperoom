// El índice solo reexporta lo puro (esquemas). `services` y `db` (Prisma) se
// importan por su subpath (`@escaperoom/shared/services`, `/db`) para no
// arrastrar el cliente de base de datos a cualquier bundle.
export * from "./schemas";
