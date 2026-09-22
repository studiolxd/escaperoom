import { type LogObj, writeToConsole } from "./shared";

// Entrada de NAVEGADOR de `@escaperoom/kit/logger` (condición `browser` del
// `exports`): mismo API que la de servidor, pero sin pino — empaquetarlo en el
// cliente no es admisible. Un componente `"use client"` que hace
// `logger.error(err, "…")` escribe en la consola del navegador.
//
// Next resuelve la condición `browser` también al compilar el runtime EDGE, así
// que este es además el logger del edge; allí la entrada de servidor ya
// escribía por consola (`isEdge`).

export const logger = {
  debug(obj: LogObj | string, msg?: string) {
    writeToConsole("debug", obj, msg);
  },

  info(obj: LogObj | string, msg?: string) {
    writeToConsole("info", obj, msg);
  },

  warn(obj: LogObj | string, msg?: string) {
    writeToConsole("warn", obj, msg);
  },

  error(obj: LogObj | Error | string, msg?: string) {
    writeToConsole("error", obj, msg);
  },

  fatal(obj: LogObj | Error | string, msg?: string) {
    writeToConsole("fatal", obj, msg);
  },
};
