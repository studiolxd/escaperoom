import type { PrismaClient } from "../../generated/client";
import {
  EMAIL_RETENTION_MONTHS,
  PURGED_EMAIL_PREFIX,
  deriveEmailPurgeHashKey,
  purgeCutoff,
  type AccessKeyEmailPurgeStore,
  type EmailPurgeSweepResult,
  type PurgeAudience,
} from "./access-key-email-purge";

/**
 * `email IS NOT NULL AND email NOT LIKE 'purged:%'` (idempotencia) sobre
 * claves de eventos hace más de `EMAIL_RETENTION_MONTHS[audience]` meses desde
 * su instante de referencia: si TODAS sus `gameSession` acabaron
 * (`ended`/`aborted`), `MAX(endedAt)`; si no (sin sesiones, o alguna
 * `pending`/`in_progress` que nunca se resuelve — E-16, ver el comentario de
 * cabecera de `access-key-email-purge.ts`), `event.createdAt` como cutoff
 * alternativo, para que un evento que nunca se jugó no conserve el email
 * indefinidamente. `hmac(...)` usa pgcrypto (ya habilitado, `0001_extensions`).
 */
async function purgeByAudience(
  prisma: PrismaClient,
  audience: PurgeAudience,
  cutoff: Date,
  secret: string,
): Promise<number> {
  // Clave derivada en Node (nunca `APP_SECRET` crudo en SQL); reproduce
  // exactamente `hashPurgedEmail` de `access-key-email-purge.ts` (E-3).
  const key = deriveEmailPurgeHashKey(secret);
  return prisma.$executeRaw`
    WITH session_agg AS (
      SELECT s."eventId",
        MAX(s."endedAt") AS "maxEndedAt",
        bool_and(s.status IN ('ended', 'aborted')) AS "allEnded"
      FROM "gameSession" s
      GROUP BY s."eventId"
    ),
    event_reference AS (
      SELECT e.id AS "eventId",
        CASE
          WHEN sa."allEnded" IS TRUE THEN sa."maxEndedAt"
          ELSE e."createdAt"
        END AS "referenceAt"
      FROM "event" e
      LEFT JOIN session_agg sa ON sa."eventId" = e.id
    )
    UPDATE "accessKey" k
    SET email = ${PURGED_EMAIL_PREFIX} || encode(hmac(convert_to(lower(k.email)::text, 'UTF8'), ${key}, 'sha256'), 'hex')
    FROM event_reference er
    JOIN "event" e ON e.id = er."eventId"
    WHERE k."eventId" = er."eventId"
      AND e.audience = ${audience}::"eventAudience"
      AND k.email IS NOT NULL
      AND k.email NOT LIKE ${`${PURGED_EMAIL_PREFIX}%`}
      AND er."referenceAt" <= ${cutoff}
  `;
}

export function createPrismaAccessKeyEmailPurgeStore(
  prisma: PrismaClient,
): AccessKeyEmailPurgeStore {
  return {
    async purgeExpiredEmails(now, secret) {
      const general = await purgeByAudience(
        prisma,
        "general",
        purgeCutoff(now, EMAIL_RETENTION_MONTHS.general),
        secret,
      );
      const educational = await purgeByAudience(
        prisma,
        "educational",
        purgeCutoff(now, EMAIL_RETENTION_MONTHS.educational),
        secret,
      );
      return { general, educational } satisfies EmailPurgeSweepResult;
    },
  };
}
