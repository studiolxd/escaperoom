import type { RoomPackage } from "../schemas";

/**
 * Runtime de compras en Colyseus (B-4, auditoría 2026-09-24): lo que la
 * `GameRoom` necesita de Postgres para jugar una sala comprada, y nada más.
 *
 * - **Paquete**: la versión exacta que el usuario compró
 *   (`purchase.roomVersionId`, del `gameToken`), nunca la última publicada.
 * - **Una compra = una partida** (specs/02): al crear la room, escritura
 *   condicional `purchase.playSessionStartedAt IS NULL → now()` con
 *   `playSessionColyseusId = <roomId>`. Si la compra ya tenía
 *   `playSessionStartedAt`, la creación se rechaza (`claimPlaySession`
 *   devuelve `false`): ya se jugó.
 *
 * Este módulo no depende de Prisma (subpath `@escaperoom/shared/game-access`):
 * la implementación sobre Postgres está en `game-access-prisma-store.ts`.
 */
export interface GameAccessStore {
  /** El paquete de la versión comprada; `null` si no existe (dato inconsistente/borrado). */
  loadRoomVersionPackage(roomVersionId: string): Promise<RoomPackage | null>;
  /**
   * Reclama la única partida de la compra para `colyseusRoomId`. `true` si
   * esta llamada ganó la escritura condicional (primera vez); `false` si la
   * compra ya tenía una partida asignada (reintento de creación tras
   * terminar/expulsar la room, o doble clic del cliente).
   */
  claimPlaySession(purchaseId: string, colyseusRoomId: string): Promise<boolean>;
}

/**
 * Store en memoria (tests): `packages` por `roomVersionId` y compras con su
 * `playSessionStartedAt` como filas mutables.
 */
export function createInMemoryGameAccessStore(opts: {
  packages: Record<string, RoomPackage>;
  purchases: Array<{ id: string; playSessionStartedAt: Date | null }>;
}): GameAccessStore & { claimedRoomIdByPurchase: Map<string, string> } {
  const claimedRoomIdByPurchase = new Map<string, string>();
  return {
    claimedRoomIdByPurchase,
    async loadRoomVersionPackage(roomVersionId) {
      const roomPackage = opts.packages[roomVersionId];
      return roomPackage ? structuredClone(roomPackage) : null;
    },
    async claimPlaySession(purchaseId, colyseusRoomId) {
      const purchase = opts.purchases.find((p) => p.id === purchaseId);
      if (!purchase || purchase.playSessionStartedAt !== null) return false;
      purchase.playSessionStartedAt = new Date();
      claimedRoomIdByPurchase.set(purchaseId, colyseusRoomId);
      return true;
    },
  };
}
