// Lo que comparten las dos entradas del logger (`index.ts`, de servidor, y
// `client.ts`, de navegador): el contrato de redacción y la escritura por
// consola. Aquí no se importa nada de `node:*` ni pino — este módulo entra en
// el bundle del navegador.
//
// Adaptado de @slxd/kit/logger/shared (ADR-017): se poda el puente a Sentry
// (este proyecto aún no lo usa) y la correlación (fuera del alcance del 0.11).

export type LogObj = Record<string, unknown>;

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

// Safety net, not a licence: call sites must still never pass PII. These keys
// are censored both locally (pino redact) and in any structured sink.
export const SENSITIVE_KEYS = ["email", "to", "password", "token", "secret"];
export const CENSOR = "[redacted]";

/** Redacts sensitive keys recursively from a structured payload. */
export function scrub(obj: LogObj): LogObj {
  const out: LogObj = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(key)) {
      out[key] = CENSOR;
    } else if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Error)
    ) {
      out[key] = scrub(value as LogObj);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Escritura por consola: el único destino cuando no hay pino (edge, navegador). */
export function writeToConsole(
  level: "debug" | "info" | "warn" | "error" | "fatal",
  obj: LogObj | Error | string,
  msg?: string,
) {
  const fn =
    level === "warn"
      ? console.warn
      : level === "error" || level === "fatal"
        ? console.error
        : console.log;
  if (typeof obj === "string") fn(obj);
  else if (msg) fn(msg, obj);
  else fn(obj);
}
