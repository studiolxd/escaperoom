import type { PrismaClient } from "../../generated/client";
import type { TermsAcceptanceRow, TermsAcceptanceStore } from "./legal-acceptance";

/** Implementación Prisma del puerto de reaceptación de términos/privacidad. */
export function createPrismaTermsAcceptanceStore(prisma: PrismaClient): TermsAcceptanceStore {
  return {
    async findAcceptedVersion(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { termsAcceptedVersion: true },
      });
      return user?.termsAcceptedVersion ?? null;
    },
    async recordAcceptance({ userId, version, ipAddress, userAgent }) {
      const [row] = await prisma.$transaction([
        prisma.termsAcceptance.create({
          data: { userId, version, ipAddress, userAgent },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { termsAcceptedVersion: version },
        }),
      ]);
      return row satisfies TermsAcceptanceRow;
    },
  };
}
