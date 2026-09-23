import type { PrismaClient } from "../../generated/client";
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
      await prisma.user.update({ where: { id: userId }, data: { stripeAccountId: accountId } });
    },
  };
}
