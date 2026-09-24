import { createHmac } from "node:crypto";
import { isDevFallbackAllowed } from "@escaperoom/env";

/**
 * Purga (por hash) de la dirección IP y el user-agent en `session` (Better
 * Auth) y `termsAcceptance`, y borrado final de la fila una vez agotado su
 * valor probatorio (specs/18 §4.1, decisión de retención basada en el mismo
 * criterio que slxd):
 *
 * - **90 días**: `ipAddress`/`userAgent` se sustituyen por un valor no
 *   reversible (hash). El registro de que hubo una sesión, o una aceptación
 *   de términos, con su fecha, se conserva intacto — solo deja de llevar un
 *   dato identificable de red/dispositivo.
 * - **2 años**: pasado ese plazo la fila entera ya no tiene valor probatorio
 *   y se borra. Mismo plazo que la analítica detallada
 *   (`ANALYTICS_RETENTION_MONTHS`, `analytics/partitions.ts`).
 *
 * `session` es de Better Auth: `ipAddress`/`userAgent` solo se escriben al
 * crear la sesión (no se releen para validarla — la validación es por
 * `token`, ver `better-auth/dist/db/internal-adapter.mjs`), así que
 * sustituirlos por SQL crudo no afecta al login. El borrado final de la fila
 * se limita además a sesiones ya caducadas (`expiresAt < now`), por
 * precaución adicional (ver `session-ip-ua-purge-prisma-store.ts`).
 */

/** Días hasta que `ipAddress`/`userAgent` se sustituyen por su hash. */
export const IP_UA_HASH_RETENTION_DAYS = 90;
/** Años hasta que la fila (sesión o aceptación) se borra por completo. */
export const IP_UA_ROW_RETENTION_YEARS = 2;

/** Prefijo del valor sustituido: permite detectar un valor ya purgado (idempotencia). */
export const PURGED_VALUE_PREFIX = "purged:";

/** Dominios de derivación de clave: uno por columna, para que no se correlacionen entre sí. */
export const IP_HASH_DOMAIN = "ip";
export const UA_HASH_DOMAIN = "ua";

export function isPurgedValue(value: string): boolean {
  return value.startsWith(PURGED_VALUE_PREFIX);
}

/** Secreto de desarrollo: solo fuera de `NODE_ENV=production`. */
export const DEV_IP_UA_PURGE_SECRET = "dev-ip-ua-purge-secret-no-usar-en-produccion";

/** `APP_SECRET`; `null` (job inactivo) sin él configurado en producción. */
export function readIpUaPurgeSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = env.APP_SECRET?.trim();
  return configured || (isDevFallbackAllowed(env) ? DEV_IP_UA_PURGE_SECRET : null);
}

/**
 * Clave derivada por dominio (HKDF-like vía HMAC): separa el hash de una IP
 * del de un user-agent (y de los de otros usos de `APP_SECRET`, como
 * `hashPurgedEmail`) para que no puedan correlacionarse entre sí. Es la MISMA
 * función que usa `IpUaPurgeStore` para pasar la clave (ya derivada, nunca
 * `APP_SECRET` crudo) al `hmac()` de pgcrypto en SQL — así el hash calculado
 * en Node y el calculado en Postgres son comparables byte a byte (E-3).
 */
export function derivePurgeHashKey(secret: string, domain: string): Buffer {
  return createHmac("sha256", secret).update(domain).digest();
}

/**
 * Hash no reversible de un valor (HMAC-SHA256 con clave derivada del secreto
 * del servidor). `domain` separa el hash de una IP del de un user-agent (y de
 * los de otros usos de `APP_SECRET`, como `hashPurgedEmail`) para que no
 * puedan correlacionarse entre sí.
 */
export function hashPurgedValue(value: string, secret: string, domain: string): string {
  const digest = createHmac("sha256", derivePurgeHashKey(secret, domain))
    .update(value)
    .digest("hex");
  return `${PURGED_VALUE_PREFIX}${digest}`;
}

/** Instante a partir del cual un registro de hace `days` días ya está fuera de plazo. */
export function hashCutoff(now: Date, days: number = IP_UA_HASH_RETENTION_DAYS): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff;
}

/** Instante a partir del cual un registro de hace `years` años ya se puede borrar. */
export function rowDeletionCutoff(now: Date, years: number = IP_UA_ROW_RETENTION_YEARS): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
}

/** Una fila candidata a que se le hasheen `ipAddress`/`userAgent`. */
export type IpUaHashCandidate = {
  ipAddress: string | null;
  userAgent: string | null;
  /** Instante del registro (`session.createdAt`, `termsAcceptance.acceptedAt`). */
  recordedAt: Date;
};

/** ¿Toca sustituir `ipAddress`/`userAgent` por su hash en `now`? Idempotente: ya hasheados → no. */
export function isIpUaHashDue(candidate: IpUaHashCandidate, now: Date): boolean {
  if (candidate.recordedAt.getTime() > hashCutoff(now).getTime()) return false;
  const ipPending = candidate.ipAddress !== null && !isPurgedValue(candidate.ipAddress);
  const uaPending = candidate.userAgent !== null && !isPurgedValue(candidate.userAgent);
  return ipPending || uaPending;
}

/** ¿Toca borrar la fila entera en `now`? */
export function isRowDeletionDue(recordedAt: Date, now: Date): boolean {
  return recordedAt.getTime() <= rowDeletionCutoff(now).getTime();
}

/** Resultado de una pasada del job sobre un modelo: cuántas filas hasheó y cuántas borró. */
export type IpUaPurgeSweepResult = { hashed: number; deleted: number };

/** Puerto de persistencia del job, uno por modelo (mismo patrón que `AccessKeyEmailPurgeStore`). */
export interface IpUaPurgeStore {
  /** Sustituye por su hash `ipAddress`/`userAgent` vencidos a `now`; UPDATE idempotente. */
  purgeIpUa(now: Date, secret: string): Promise<number>;
  /** Borra las filas cuyo registro tiene más de `IP_UA_ROW_RETENTION_YEARS`. */
  deleteExpiredRows(now: Date): Promise<number>;
}

/** Pasada del job sobre un modelo; delega toda la selección al store (SQL o memoria). */
export async function sweepIpUaRetention(
  store: IpUaPurgeStore,
  now: Date,
  secret: string,
): Promise<IpUaPurgeSweepResult> {
  const hashed = await store.purgeIpUa(now, secret);
  const deleted = await store.deleteExpiredRows(now);
  return { hashed, deleted };
}
