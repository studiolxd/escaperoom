import type { PrismaClient } from "../../generated/client/client";
import type { OrganizationDpaRow, OrganizationStore } from "./organizations";

const DPA_SELECT = { id: true, dpaSignedAt: true, dpaVersion: true, dpaSignedBy: true } as const;

/**
 * Implementación Prisma del puerto de organizaciones (ticket 5.11) sobre
 * `organization` (`dpaSignedAt` de 0003; `dpaVersion`/`dpaSignedBy` de
 * `0014_organization_dpa`) y `member` (Better Auth).
 */
export function createPrismaOrganizationStore(prisma: PrismaClient): OrganizationStore {
  return {
    async findOrganization(id): Promise<OrganizationDpaRow | null> {
      return prisma.organization.findUnique({ where: { id }, select: DPA_SELECT });
    },

    async findMemberRole(organizationId, userId) {
      const row = await prisma.member.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { role: true },
      });
      return row?.role ?? null;
    },

    async recordDpaSignature(organizationId, { version, signedBy, signedAt }) {
      return prisma.organization.update({
        where: { id: organizationId },
        data: { dpaVersion: version, dpaSignedBy: signedBy, dpaSignedAt: signedAt },
        select: DPA_SELECT,
      });
    },
  };
}
