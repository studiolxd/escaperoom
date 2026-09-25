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
  level: "debug" | "info" | "warn" | "error" | "fatal",
  obj: LogObj | Error | string,
  msg?: string,
) {
  if (isEdge || !pinoLogger) {
    writeToConsole(level, obj, msg);
    return;
  }
  // Un `Error` suelto se loguea tal cual: pino lo serializa con su stack.
  pinoLogger[level](obj as LogObj, msg);
}

/**
 * Logger estructurado de servidor. Nivel por `LOG_LEVEL` (default: `debug` en
 * desarrollo, `info` en el resto). Redacta claves sensibles.
 */
export const logger = {
  debug(obj: LogObj | string, msg?: string) {
    write("debug", obj, msg);
  },

  info(obj: LogObj | string, msg?: string) {
    write("info", obj, msg);
  },

  warn(obj: LogObj | string, msg?: string) {
    write("warn", obj, msg);
  },

  error(obj: LogObj | Error | string, msg?: string) {
    write("error", obj, msg);
  },

  fatal(obj: LogObj | Error | string, msg?: string) {
    write("fatal", obj, msg);
  },
};
