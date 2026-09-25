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
// are censored both locally (`scrub`, every level and inside arrays — E-10)
// and in any structured sink. Case-insensitive match (`matchesSensitiveKey`):
// a field named `Authorization` or `ACCESS_TOKEN` is just as sensitive as
// `authorization`/`accessToken`.
//
// Deliberadamente NO incluye `code` a secas (lo mencionaba E-10): es un
// nombre de campo demasiado genérico en este repo — lo usan los errores de
// dominio para su código legible (`{code: "ALREADY_PROCESSED"}`,
// `stripe-webhook.ts:185`) muchas más veces que cualquier valor sensible, y
// redactarlo a ciegas rompería justo los logs que hacen falta para depurar
// (la propia auditoría avisa de este riesgo). El caso real que motivaba
// incluirlo — códigos canjeables de tarjetas en `job.data` — ya no aplica:
// E-8 quitó esos códigos del payload del job.
export const SENSITIVE_KEYS = [
  "email",
  "to",
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "accessToken",
  "refreshToken",
  "idToken",
  "apiKey",
  "ipAddress",
  "userAgent",
];
export const CENSOR = "[redacted]";

const SENSITIVE_KEYS_LOWER = new Set(SENSITIVE_KEYS.map((k) => k.toLowerCase()));

function matchesSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS_LOWER.has(key.toLowerCase());
}

/**
 * Redacts sensitive keys recursively from a structured payload, at any depth
 * and inside arrays (E-10: la redacción de un solo nivel dejaba pasar
 * `{user: {email}}` o listas de objetos con datos sensibles, p. ej.
 * `job.data` de una cola fallida).
 */
export function scrub<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => scrub(item)) as unknown as T;
  }
  if (value instanceof Error || value === null || typeof value !== "object") {
    return value;
  }
  const out: LogObj = {};
  for (const [key, v] of Object.entries(value as LogObj)) {
    out[key] = matchesSensitiveKey(key) ? CENSOR : scrub(v);
  }
  return out as T;
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
  // `Error` no se toca: sus claves propias (message/stack) no son un mapa de
  // campos arbitrarios y `scrub` ya la deja pasar tal cual.
  const safeObj = typeof obj === "string" || obj instanceof Error ? obj : scrub(obj);
  if (typeof safeObj === "string") fn(safeObj);
  else if (msg) fn(msg, safeObj);
  else fn(safeObj);
}
