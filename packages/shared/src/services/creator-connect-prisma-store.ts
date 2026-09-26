import type { PrismaClient } from "../../generated/client/client";
import type { CreatorConnectStore } from "./creator-connect";

/** Implementación Prisma: `user.stripeAccountId` ya existe (0003_auth), sin migración. */
export function createPrismaCreatorConnectStore(prisma: PrismaClient): CreatorConnectStore {
  return {
    async findUser(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, stripeAccountId: true },
      });
      return user;
    },
    async saveAccountId(userId, accountId) {
      const { count } = await prisma.user.updateMany({
        where: { id: userId, stripeAccountId: null },
        data: { stripeAccountId: accountId },
      });
      return count > 0;
    },
  };
}
