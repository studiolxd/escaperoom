import pino from "pino";
import { scrub, writeToConsole, type LogObj } from "./shared";

// Entrada de SERVIDOR (Node y edge). El `exports` del paquete desvía el
// navegador a `./client.ts`: un bundle de cliente no puede empaquetar pino.
//
// Reads LOG_LEVEL straight from process.env rather than through an app's
// `@/env`: every app declares it as an optional string with the same
// default, so this is a behavior-preserving passthrough that keeps adoption
// to a single import swap — no wiring, no factory call.
//
// Adaptado de @slxd/kit/logger (ADR-017): sin Sentry ni correlation.

const isEdge = process.env.NEXT_RUNTIME === "edge";
const isDev = process.env.NODE_ENV === "development";

const pinoLogger = isEdge
  ? null
  : pino({
      level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
      // `scrub` (no el `redact` de paths de pino, que no cubre profundidad ni
      // arrays arbitrarios — E-10) recorre TODO el objeto de log, a cualquier
      // nivel y dentro de listas, antes de serializar.
      formatters: {
        log(obj) {
          return scrub(obj) as Record<string, unknown>;
        },
      },
      ...(isDev && {
        transport: { target: "pino-pretty", options: { colorize: true } },
      }),
    });

function write(
  target: pino.Logger | null,
  level: "debug" | "info" | "warn" | "error" | "fatal",
  obj: LogObj | Error | string,
  msg?: string,
) {
  if (isEdge || !target) {
    writeToConsole(level, obj, msg);
    return;
  }
  // Un `Error` suelto se loguea tal cual: pino lo serializa con su stack.
  target[level](obj as LogObj, msg);
}

export interface Logger {
  debug(obj: LogObj | string, msg?: string): void;
  info(obj: LogObj | string, msg?: string): void;
  warn(obj: LogObj | string, msg?: string): void;
  error(obj: LogObj | Error | string, msg?: string): void;
  fatal(obj: LogObj | Error | string, msg?: string): void;
  /**
   * Logger hijo con `bindings` ya fijos en cada línea (p. ej. `{ roomId }` en
   * `colyseus-server`, C-20): evita repetirlos en cada llamada. En edge (sin
   * pino) cae al mismo `writeToConsole`, mezclando `bindings` a mano.
   */
  child(bindings: Record<string, unknown>): Logger;
}

function createLogger(target: pino.Logger | null, bindings: Record<string, unknown> = {}): Logger {
  // Un `target` real de pino ya lleva `bindings` fijados por `.child()`
  // (`write` los serializa solo); sin pino (edge/consola) no hay tal cosa, así
  // que `writeToConsole` necesita que se los mezclemos aquí a mano.
  const merge = (obj: LogObj | Error | string): LogObj | Error | string =>
    target || obj instanceof Error || typeof obj === "string" ? obj : { ...bindings, ...obj };
  return {
    debug(obj, msg) {
      write(target, "debug", merge(obj), msg);
    },
    info(obj, msg) {
      write(target, "info", merge(obj), msg);
    },
    warn(obj, msg) {
      write(target, "warn", merge(obj), msg);
    },
    error(obj, msg) {
      write(target, "error", merge(obj), msg);
    },
    fatal(obj, msg) {
      write(target, "fatal", merge(obj), msg);
    },
    child(childBindings) {
      return createLogger(target?.child(childBindings) ?? null, { ...bindings, ...childBindings });
    },
  };
}

/**
 * Logger estructurado de servidor. Nivel por `LOG_LEVEL` (default: `debug` en
 * desarrollo, `info` en el resto). Redacta claves sensibles.
 */
export const logger: Logger = createLogger(pinoLogger);
