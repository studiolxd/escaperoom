import type { PrismaClient } from "../../generated/client";
import type { MeProfileRow, MeStore } from "./me";

/**
 * Implementación Prisma de `MeStore`: `select` acotado a lo que expone la
 * respuesta (antes `include: { member: { include: { organization: true } },
 * creditAccount: true }` traía la organización y `creditAccount` enteras).
 */
export function createPrismaMeStore(prisma: PrismaClient): MeStore {
  return {
    async findProfile(userId): Promise<MeProfileRow | null> {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          locale: true,
          isAdmin: true,
          isModerator: true,
          creditAccount: {
            where: { userId: { not: null } },
            select: { balanceCredits: true },
            take: 1,
          },
          member: {
            select: {
              role: true,
              organization: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        locale: user.locale,
        isAdmin: user.isAdmin,
        isModerator: user.isModerator,
        personalBalanceCredits: user.creditAccount[0]?.balanceCredits ?? 0n,
        organizations: user.member.map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
        })),
      };
    },
  };
}
