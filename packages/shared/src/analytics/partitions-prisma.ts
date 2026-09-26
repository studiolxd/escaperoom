import type { PrismaClient } from "../../generated/client/client";
import type { PartitionMaintenanceDb } from "./partitions";

/**
 * `PartitionMaintenanceDb` sobre una transacción interactiva de Prisma. El
 * mantenimiento es DDL corto, pero se amplían los plazos por defecto (5 s) para
 * que un `lock_timeout` de 10 s pueda saltar antes que el de la transacción.
 */
export function createPrismaPartitionMaintenanceDb(
  prisma: Pick<PrismaClient, "$transaction">,
): PartitionMaintenanceDb {
  return {
    transaction: (fn) =>
      prisma.$transaction(
        (tx) =>
          fn({
            query: <T>(sql: string) => tx.$queryRawUnsafe<T[]>(sql),
            execute: async (sql: string) => {
              await tx.$executeRawUnsafe(sql);
            },
          }),
        { maxWait: 10_000, timeout: 60_000 },
      ),
  };
}
