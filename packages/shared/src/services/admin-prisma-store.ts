import type { Prisma, PrismaClient } from "../../generated/client";
import type { AdminDirectory } from "./admin";
import type { PlatformSettingStore } from "./platform-settings";
import type { PricingTierStore, PricingTierTx } from "./pricing-tiers";

type Db = PrismaClient | Prisma.TransactionClient;

/** `user.isAdmin` consultado en cada llamada (sin cachear en la sesión). */
function adminDirectory(prisma: PrismaClient): AdminDirectory {
  return {
    async isAdmin(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      return user?.isAdmin === true;
    },
  };
}

/** Implementación Prisma de `platformSetting` (specs/14 §8). */
export function createPrismaPlatformSettingStore(prisma: PrismaClient): PlatformSettingStore {
  return {
    ...adminDirectory(prisma),
    findSetting(key) {
      return prisma.platformSetting.findUnique({ where: { key } });
    },
    upsertSetting(key, value, updatedBy) {
      const json = value as Prisma.InputJsonValue;
      const updatedAt = new Date();
      return prisma.platformSetting.upsert({
        where: { key },
        create: { key, value: json, updatedBy, updatedAt },
        update: { value: json, updatedBy, updatedAt },
      });
    },
  };
}

function pricingTx(db: Db): PricingTierTx {
  return {
    listTiers() {
      return db.pricingTier.findMany({ orderBy: [{ minPlayers: "asc" }, { activeFrom: "asc" }] });
    },
    findTier(id) {
      return db.pricingTier.findUnique({ where: { id } });
    },
    insertTier(tier) {
      return db.pricingTier.create({ data: tier });
    },
    closeTier(id, activeUntil) {
      // Única escritura sobre una fila existente: su cierre (specs/02 §3.2).
      return db.pricingTier.update({ where: { id }, data: { activeUntil } });
    },
  };
}

/**
 * Implementación Prisma de `pricingTier`. Las escrituras se serializan con un
 * advisory lock de transacción: la comprobación de solapes y el cierre +
 * inserción del sucesor son atómicos frente a otro admin editando a la vez.
 */
export function createPrismaPricingTierStore(prisma: PrismaClient): PricingTierStore {
  return {
    ...adminDirectory(prisma),
    listTiers: pricingTx(prisma).listTiers,
    withPricingLock(fn) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pricingTier'))`;
        return fn(pricingTx(tx));
      });
    },
  };
}
