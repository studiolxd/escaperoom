/**
 * Servicios de dominio — única lógica invocada por tRPC (UI), REST, MCP y
 * Colyseus (ADR-010/022). Todos los servicios reciben un `actor` explícito y
 * sus dependencias se inyectan, de modo que se testean sin infraestructura.
 */
export * from "./actor";
export * from "./catalog";
export * from "./room-package-repository";
