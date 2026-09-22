import { PrismaClient } from "../../generated/client";

/**
 * Cliente Prisma compartido (ADR-015). Los tipos y el cliente se generan con
 * `prisma generate` desde `packages/shared/prisma/schema.prisma`.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "../../generated/client";
