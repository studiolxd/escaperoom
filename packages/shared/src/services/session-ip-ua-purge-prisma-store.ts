import type { PrismaClient } from "../../generated/client";
import {
  IP_UA_HASH_RETENTION_DAYS,
  IP_UA_ROW_RETENTION_YEARS,
  PURGED_VALUE_PREFIX,
  hashCutoff,
  rowDeletionCutoff,
  type IpUaPurgeStore,
} from "./ip-ua-purge";

const PURGED_LIKE = `${PURGED_VALUE_PREFIX}%`;

/**
 * `ipAddress`/`userAgent NOT LIKE 'purged:%'` (idempotencia) sobre sesiones
 * creadas hace más de `IP_UA_HASH_RETENTION_DAYS` días → hash con pgcrypto.
 *
 * `session` es de Better Auth: sustituir estos campos por SQL crudo no la
 * rompe (ver el comentario de cabecera de `ip-ua-purge.ts`), pero el
 * **borrado de la fila** se limita además a sesiones ya caducadas
 * (`expiresAt < now`) por precaución adicional, aunque a 2 años de
 * antigüedad una sesión (vida típica de días/semanas) ya está caducada en la
 * práctica.
 */
export function createPrismaSessionIpUaPurgeStore(prisma: PrismaClient): IpUaPurgeStore {
  return {
    async purgeIpUa(now, secret) {
      const cutoff = hashCutoff(now, IP_UA_HASH_RETENTION_DAYS);
      return prisma.$executeRaw`
        UPDATE "session"
        SET
          "ipAddress" = CASE
            WHEN "ipAddress" IS NOT NULL AND "ipAddress" NOT LIKE ${PURGED_LIKE}
            THEN ${PURGED_VALUE_PREFIX} || encode(hmac("ipAddress", ${secret}, 'sha256'), 'hex')
            ELSE "ipAddress"
          END,
          "userAgent" = CASE
            WHEN "userAgent" IS NOT NULL AND "userAgent" NOT LIKE ${PURGED_LIKE}
            THEN ${PURGED_VALUE_PREFIX} || encode(hmac("userAgent", ${secret}, 'sha256'), 'hex')
            ELSE "userAgent"
          END
        WHERE "createdAt" <= ${cutoff}
          AND (
            ("ipAddress" IS NOT NULL AND "ipAddress" NOT LIKE ${PURGED_LIKE})
            OR ("userAgent" IS NOT NULL AND "userAgent" NOT LIKE ${PURGED_LIKE})
          )
      `;
    },
    async deleteExpiredRows(now) {
      const cutoff = rowDeletionCutoff(now, IP_UA_ROW_RETENTION_YEARS);
      return prisma.$executeRaw`
        DELETE FROM "session"
        WHERE "createdAt" <= ${cutoff}
          AND "expiresAt" < ${now}
      `;
    },
  };
}
