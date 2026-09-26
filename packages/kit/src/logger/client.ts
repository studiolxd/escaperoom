import { type LogObj, writeToConsole } from "./shared";

// Entrada de NAVEGADOR de `@escaperoom/kit/logger` (condición `browser` del
// `exports`): mismo API que la de servidor, pero sin pino — empaquetarlo en el
// cliente no es admisible. Un componente `"use client"` que hace
// `logger.error(err, "…")` escribe en la consola del navegador.
//
// Next resuelve la condición `browser` también al compilar el runtime EDGE, así
// que este es además el logger del edge; allí la entrada de servidor ya
// escribía por consola (`isEdge`).

export interface Logger {
  debug(obj: LogObj | string, msg?: string): void;
  info(obj: LogObj | string, msg?: string): void;
  warn(obj: LogObj | string, msg?: string): void;
  error(obj: LogObj | Error | string, msg?: string): void;
  fatal(obj: LogObj | Error | string, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const merge = (obj: LogObj | Error | string): LogObj | Error | string =>
    obj instanceof Error || typeof obj === "string" ? obj : { ...bindings, ...obj };
  return {
    debug(obj, msg) {
      writeToConsole("debug", merge(obj), msg);
    },
    info(obj, msg) {
      writeToConsole("info", merge(obj), msg);
    },
    warn(obj, msg) {
      writeToConsole("warn", merge(obj), msg);
    },
    error(obj, msg) {
      writeToConsole("error", merge(obj), msg);
    },
    fatal(obj, msg) {
      writeToConsole("fatal", merge(obj), msg);
    },
    child(childBindings) {
      return createLogger({ ...bindings, ...childBindings });
    },
  };
}

export const logger: Logger = createLogger();
