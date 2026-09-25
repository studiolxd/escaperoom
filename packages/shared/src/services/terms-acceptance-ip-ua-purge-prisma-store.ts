import type { PrismaClient } from "../../generated/client";
import {
  IP_HASH_DOMAIN,
  IP_UA_HASH_RETENTION_DAYS,
  IP_UA_ROW_RETENTION_YEARS,
  PURGED_VALUE_PREFIX,
  UA_HASH_DOMAIN,
  derivePurgeHashKey,
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
      // Clave derivada por dominio en Node (nunca `APP_SECRET` crudo en SQL);
      // `hmac(col, key, 'sha256')` en Postgres reproduce exactamente
      // `hashPurgedValue` de `ip-ua-purge.ts` (misma clave, mismo HMAC).
      const ipKey = derivePurgeHashKey(secret, IP_HASH_DOMAIN);
      const uaKey = derivePurgeHashKey(secret, UA_HASH_DOMAIN);
      return prisma.$executeRaw`
        UPDATE "termsAcceptance"
        SET
          "ipAddress" = CASE
            WHEN "ipAddress" IS NOT NULL AND "ipAddress" NOT LIKE ${PURGED_LIKE}
            THEN ${PURGED_VALUE_PREFIX} || encode(hmac(convert_to("ipAddress", 'UTF8'), ${ipKey}, 'sha256'), 'hex')
            ELSE "ipAddress"
          END,
          "userAgent" = CASE
            WHEN "userAgent" IS NOT NULL AND "userAgent" NOT LIKE ${PURGED_LIKE}
            THEN ${PURGED_VALUE_PREFIX} || encode(hmac(convert_to("userAgent", 'UTF8'), ${uaKey}, 'sha256'), 'hex')
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
