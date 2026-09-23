import { createHmac } from "node:crypto";

/**
 * Purga (por hash) del email de un participante en `accessKey` pasado el
 * plazo de retención (ticket 5.5/18, specs/18 §4.1; PR #109 fija los plazos en
 * `privacy.ts` §4 y `dpa-template.ts` §6, aún sin job que los ejecutase):
 *
 * - **12 meses** tras la finalización del evento, en general.
 * - **3 meses** cuando `event.audience === "educational"` (minimización
 *   reforzada: puede haber menores, specs/18 §4.1).
 * - Pasado el plazo, `email` se sustituye por un valor no reversible (hash);
 *   la fila de la clave se conserva (hace falta para el historial de canje y
 *   analítica), solo deja de llevar un email identificable.
 *
 * **"El evento terminó"**: el esquema no tiene un campo propio para ello
 * (`event` no lleva fecha de fin ni transición automática a `closed` — nada en
 * el código la dispara hoy). La señal que se usa aquí es indirecta: TODAS las
 * sesiones de partida (`gameSession`) del evento han acabado (`ended` o
 * `aborted`, que siempre sellan `endedAt` juntos — ver
 * `event-runtime-prisma-store.ts`), tomando la más tardía como instante de
 * fin. Un evento sin sesiones creadas, o con alguna aún `pending`/
 * `in_progress`, no cuenta como terminado y no purga nada. Es una heurística
 * razonable (no un campo inequívoco del dominio); si el negocio define en el
 * futuro un fin de evento explícito, esta es la pieza a actualizar.
 */

/** Meses de retención del email según la audiencia del evento. */
export const EMAIL_RETENTION_MONTHS = { general: 12, educational: 3 } as const;
export type PurgeAudience = keyof typeof EMAIL_RETENTION_MONTHS;

/** Prefijo del valor sustituido: permite detectar un email ya purgado (idempotencia). */
export const PURGED_EMAIL_PREFIX = "purged:";

export function isPurgedEmail(email: string): boolean {
  return email.startsWith(PURGED_EMAIL_PREFIX);
}

/** Secreto de desarrollo: solo fuera de `NODE_ENV=production`. */
export const DEV_EMAIL_PURGE_SECRET = "dev-email-purge-secret-no-usar-en-produccion";

/** `APP_SECRET`; `null` (job inactivo) sin él configurado en producción. */
export function readEmailPurgeSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = env.APP_SECRET?.trim();
  return configured || (env.NODE_ENV === "production" ? null : DEV_EMAIL_PURGE_SECRET);
}

/** Clave derivada: separación de dominio respecto a otros usos de `APP_SECRET`. */
function hashingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("escaperoom/access-key-email-purge/v1").digest();
}

/**
 * Hash no reversible del email (HMAC-SHA256 con clave derivada del secreto del
 * servidor). No hace falta que sea criptográficamente fuerte ni útil para nada
 * más: no protege ningún dato tras la sustitución, solo deja constancia de que
 * hubo un email distinto en cada fila sin poder reconstruirlo.
 */
export function hashPurgedEmail(email: string, secret: string): string {
  const digest = createHmac("sha256", hashingKey(secret))
    .update(email.toLowerCase())
    .digest("hex");
  return `${PURGED_EMAIL_PREFIX}${digest}`;
}

/** Instante a partir del cual un evento terminado hace `months` meses ya está fuera de plazo. */
export function purgeCutoff(now: Date, months: number): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

/** Una clave candidata a purga, ya resuelta la audiencia y el fin del evento. */
export type AccessKeyEmailCandidate = {
  email: string | null;
  audience: PurgeAudience;
  /** `MAX(endedAt)` de las sesiones del evento; `null` si el evento no ha terminado. */
  eventEndedAt: Date | null;
};

/** ¿Toca sustituir el email de esta clave por su hash en `now`? Idempotente: ya hasheado → no. */
export function isEmailPurgeDue(candidate: AccessKeyEmailCandidate, now: Date): boolean {
  if (!candidate.email || isPurgedEmail(candidate.email)) return false;
  if (candidate.eventEndedAt === null) return false;
  const cutoff = purgeCutoff(now, EMAIL_RETENTION_MONTHS[candidate.audience]);
  return candidate.eventEndedAt.getTime() <= cutoff.getTime();
}

/** Claves purgadas en una pasada del job, por audiencia. */
export type EmailPurgeSweepResult = { general: number; educational: number };

/** Puerto de persistencia del job (mismo patrón que `AccessKeyStore`, ADR-022). */
export interface AccessKeyEmailPurgeStore {
  /** Sustituye por su hash los emails vencidos a `now`; UPDATE idempotente. */
  purgeExpiredEmails(now: Date, secret: string): Promise<EmailPurgeSweepResult>;
}

/** Pasada del job; delega toda la selección al store (SQL o memoria). */
export function purgeAccessKeyEmails(
  store: AccessKeyEmailPurgeStore,
  now: Date,
  secret: string,
): Promise<EmailPurgeSweepResult> {
  return store.purgeExpiredEmails(now, secret);
}
