import { signGameAccessToken } from "./game-access-token";
import { isAnonymous, type Actor } from "./actor";

/**
 * `GET /api/rooms/:roomId/access` (B-4, auditoría 2026-09-24; specs/13):
 * la compra B2C no concedía nada — no existía esta ruta ni el gate en el
 * matchmake de Colyseus. `{ owned, playable }` sigue la forma de specs/13;
 * cuando `playable`, además emite el `gameToken` (C-4) que la `GameRoom`
 * exige para crear/unirse a la partida comprada.
 */

/** La compra `room` `succeeded` más reciente de este usuario para esta sala; `null` si no tiene. */
export type RoomAccessPurchase = {
  purchaseId: string;
  roomVersionId: string;
  /** `null` = la partida de esta compra aún no se ha jugado (specs/02: una compra = una partida). */
  playSessionStartedAt: Date | null;
};

export interface RoomAccessStore {
  findRoomPurchase(userId: string, roomId: string): Promise<RoomAccessPurchase | null>;
}

export type RoomAccessResult = { owned: boolean; playable: boolean; gameToken?: string };

export function createRoomAccessService(deps: {
  store: RoomAccessStore;
  gameToken: { secret: string; ttlSeconds: number };
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  return {
    /** Sin sesión: como si no tuviera la sala (nunca revela si existe una compra ajena). */
    async getAccess(actor: Actor, roomId: string): Promise<RoomAccessResult> {
      if (isAnonymous(actor)) return { owned: false, playable: false };
      const purchase = await deps.store.findRoomPurchase(actor.userId, roomId);
      if (!purchase) return { owned: false, playable: false };
      if (purchase.playSessionStartedAt !== null) return { owned: true, playable: false };

      const issuedAt = now().getTime();
      const gameToken = signGameAccessToken(
        deps.gameToken.secret,
        {
          kind: "purchase",
          purchaseId: purchase.purchaseId,
          userId: actor.userId,
          roomVersionId: purchase.roomVersionId,
        },
        { now: issuedAt, expiresAt: issuedAt + deps.gameToken.ttlSeconds * 1000 },
      );
      return { owned: true, playable: true, gameToken };
    },
  };
}

export type RoomAccessService = ReturnType<typeof createRoomAccessService>;

// ── Implementación en memoria (tests) ───────────────────────────────────────

export type InMemoryRoomAccessPurchase = {
  userId: string;
  roomId: string;
  purchaseId: string;
  roomVersionId: string;
  status: "pending" | "succeeded" | "refunded" | "failed";
  playSessionStartedAt: Date | null;
};

export function createInMemoryRoomAccessStore(
  purchases: InMemoryRoomAccessPurchase[],
): RoomAccessStore {
  return {
    async findRoomPurchase(userId, roomId) {
      const match = purchases.find(
        (p) => p.userId === userId && p.roomId === roomId && p.status === "succeeded",
      );
      return match
        ? {
            purchaseId: match.purchaseId,
            roomVersionId: match.roomVersionId,
            playSessionStartedAt: match.playSessionStartedAt,
          }
        : null;
    },
  };
}
