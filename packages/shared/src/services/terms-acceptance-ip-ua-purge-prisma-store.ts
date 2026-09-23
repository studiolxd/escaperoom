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
 * Igual que `session-ip-ua-purge-prisma-store.ts` pero sobre `termsAcceptance`,
 * usando `acceptedAt` como instante del registro para ambos plazos. A los 2
 * años se borra la fila entera: el histórico de aceptaciones ya no hace falta
 * pasado ese plazo (el dato relevante en el día a día es
 * `user.termsAcceptedVersion`, desnormalizado).
 */
export function createPrismaTermsAcceptanceIpUaPurgeStore(prisma: PrismaClient): IpUaPurgeStore {
  return {
    async purgeIpUa(now, secret) {
      const cutoff = hashCutoff(now, IP_UA_HASH_RETENTION_DAYS);
      return prisma.$executeRaw`
        UPDATE "termsAcceptance"
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
        WHERE "acceptedAt" <= ${cutoff}
          AND (
            ("ipAddress" IS NOT NULL AND "ipAddress" NOT LIKE ${PURGED_LIKE})
            OR ("userAgent" IS NOT NULL AND "userAgent" NOT LIKE ${PURGED_LIKE})
          )
      `;
    },
    async deleteExpiredRows(now) {
      const cutoff = rowDeletionCutoff(now, IP_UA_ROW_RETENTION_YEARS);
      return prisma.$executeRaw`
        DELETE FROM "termsAcceptance"
        WHERE "acceptedAt" <= ${cutoff}
      `;
    },
  };
}
