/**
 * Chat en partida (specs/11 §4.4, §9; specs/17 §3).
 *
 * Módulo puro compartido por el servidor de Colyseus (room) y el cliente web:
 * contrato Zod del mensaje, filtro de lenguaje básico, rate limit y ventana
 * móvil del historial. Sin dependencias de infraestructura.
 */
export * from "./constants";
export * from "./schema";
export * from "./filter";
export * from "./rate-limit";
export * from "./history";
