import type { PrismaClient } from "../../generated/client";
import {
  EMAIL_RETENTION_MONTHS,
  PURGED_EMAIL_PREFIX,
  purgeCutoff,
  type AccessKeyEmailPurgeStore,
  type EmailPurgeSweepResult,
  type PurgeAudience,
} from "./access-key-email-purge";

/**
 * `email IS NOT NULL AND email NOT LIKE 'purged:%'` (idempotencia) sobre
 * claves de eventos con TODAS sus `gameSession` acabadas (`ended`/`aborted`,
 * `MAX(endedAt)` como fin del evento — ver el comentario de cabecera de
 * `access-key-email-purge.ts`) hace más de `EMAIL_RETENTION_MONTHS[audience]`
 * meses. `hmac(...)` usa pgcrypto (ya habilitado, `0001_extensions`).
 */
async function purgeByAudience(
  prisma: PrismaClient,
  audience: PurgeAudience,
  cutoff: Date,
  secret: string,
): Promise<number> {
  return prisma.$executeRaw`
    WITH ended_events AS (
      SELECT s."eventId", MAX(s."endedAt") AS "eventEndedAt"
      FROM "gameSession" s
      GROUP BY s."eventId"
      HAVING bool_and(s.status IN ('ended', 'aborted'))
    )
    UPDATE "accessKey" k
    SET email = ${PURGED_EMAIL_PREFIX} || encode(hmac(lower(k.email)::text, ${secret}, 'sha256'), 'hex')
    FROM ended_events ee
    JOIN "event" e ON e.id = ee."eventId"
    WHERE k."eventId" = ee."eventId"
      AND e.audience = ${audience}::"eventAudience"
      AND k.email IS NOT NULL
      AND k.email NOT LIKE ${`${PURGED_EMAIL_PREFIX}%`}
      AND ee."eventEndedAt" <= ${cutoff}
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
