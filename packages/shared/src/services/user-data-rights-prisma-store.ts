import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/client";
import type { UserDataExportBundle, UserDataRightsStore, UserProfileRow } from "./user-data-rights";

const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  image: true,
  locale: true,
  isAdmin: true,
  isModerator: true,
  createdAt: true,
} as const;

/** Email/nombre anónimos tras `DELETE /api/me` (specs/18 §3.4); únicos por `userId`. */
function anonymizedEmail(userId: string): string {
  return `deleted-${userId}@deleted.escaperoom.invalid`;
}
const ANONYMIZED_NAME = "Usuario eliminado";

/**
 * Implementación Prisma de los derechos RGPD sobre la cuenta propia (ticket
 * 6.2, specs/18 §3.4). `anonymizeAccount` es una transacción: anonimiza
 * `user` y revoca `session`/`account` (Better Auth); no toca `purchase`,
 * `review`, `room` ni el historial de moderación (ver `user-data-rights.ts`).
 */
export function createPrismaUserDataRightsStore(prisma: PrismaClient): UserDataRightsStore {
  return {
    async findProfile(userId): Promise<UserProfileRow | null> {
      return prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
    },

    async loadExportBundle(userId): Promise<Omit<UserDataExportBundle, "profile">> {
      const [
        memberships,
        creditAccount,
        rooms,
        purchases,
        events,
        reviews,
        strikes,
        appeals,
        reports,
      ] = await Promise.all([
        prisma.member.findMany({
          where: { userId },
          select: { organizationId: true, role: true, organization: { select: { name: true, slug: true } } },
        }),
        prisma.creditAccount.findFirst({ where: { userId }, select: { balanceCredits: true } }),
        prisma.room.findMany({
          where: { authorId: userId },
          select: { id: true, title: true, status: true, createdAt: true, updatedAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.purchase.findMany({
          where: { userId },
          select: {
            id: true,
            purchaseType: true,
            amountCents: true,
            currency: true,
            status: true,
            createdAt: true,
            room: { select: { title: true } },
            roomVersion: { select: { room_roomVersion_roomIdToroom: { select: { title: true } } } },
            event: { select: { title: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.event.findMany({
          where: { organizerId: userId },
          select: { id: true, title: true, status: true, audience: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.review.findMany({
          where: { userId },
          select: {
            roomId: true,
            rating: true,
            text: true,
            createdAt: true,
            updatedAt: true,
            hiddenAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.moderationStrike.findMany({
          where: { userId },
          select: { id: true, severity: true, consequence: true, createdAt: true, revokedAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.moderationAppeal.findMany({
          where: { creatorId: userId },
          select: { id: true, reason: true, status: true, createdAt: true, reviewedAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.contentReport.findMany({
          where: { reporterId: userId },
          select: { id: true, reason: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      return {
        organizations: memberships.map((m) => ({
          organizationId: m.organizationId,
          name: m.organization.name,
          slug: m.organization.slug,
          role: m.role,
        })),
        personalCreditsBalance: Number(creditAccount?.balanceCredits ?? 0n),
        roomsAuthored: rooms,
        purchases: purchases.map((p) => ({
          id: p.id,
          purchaseType: p.purchaseType,
          amountCents: p.amountCents,
          currency: p.currency,
          status: p.status,
          createdAt: p.createdAt,
          roomTitle: p.room?.title ?? p.roomVersion?.room_roomVersion_roomIdToroom?.title ?? null,
          eventTitle: p.event?.title ?? null,
        })),
        eventsOrganized: events,
        reviews: reviews.map((r) => ({
          roomId: r.roomId,
          rating: r.rating,
          text: r.text,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          hidden: r.hiddenAt !== null,
        })),
        moderationStrikesReceived: strikes,
        moderationAppealsFiled: appeals,
        contentReportsFiled: reports,
      };
    },

    async anonymizeAccount(userId, at): Promise<void> {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            email: anonymizedEmail(randomUUID()),
            name: ANONYMIZED_NAME,
            image: null,
            emailVerified: false,
            deletedAt: at,
            updatedAt: at,
          },
        }),
        prisma.session.deleteMany({ where: { userId } }),
        prisma.account.deleteMany({ where: { userId } }),
      ]);
    },
  };
}
