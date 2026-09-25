import { PLAY_SESSION_STALE_AFTER_SECONDS } from "./game-access";
import { signGameAccessToken } from "./game-access-token";
import { isAnonymous, type Actor } from "./actor";

/**
 * `GET /api/rooms/:roomId/access` (B-4, auditoría 2026-09-24; specs/13):
 * la compra B2C no concedía nada — no existía esta ruta ni el gate en el
 * matchmake de Colyseus. La partida de una compra se consume al TERMINAR
 * (decisión del README): `{ owned, playable, gameToken?, roomId? }` refleja
 * los tres estados de la compra —
 *
 * - **libre** (`playSessionStartedAt` `NULL`, o "en curso" pero caducada —
 *   ver `PLAY_SESSION_STALE_AFTER_SECONDS`): `playable: true`, `gameToken`
 *   sin `roomId` (el cliente CREA una `GameRoom`).
 * - **en curso** (reclamada y no caducada): `playable: true`, `gameToken` de
 *   la MISMA compra (el `onAuth` de la `GameRoom` solo la acepta si coincide)
 *   y `roomId` = `playSessionColyseusId` (el cliente se UNE a esa room, no
 *   crea otra).
 * - **consumida** (`playSessionEndedAt` fijado): `playable: false`, sin
 *   `gameToken`.
 *
 * El estado real solo lo decide la escritura condicional de
 * `GameAccessStore.claimPlaySession` en `GameRoom.onCreate`; esta ruta solo
 * lee y nunca escribe.
 */

/** La compra `room` `succeeded` más reciente de este usuario para esta sala; `null` si no tiene. */
export type RoomAccessPurchase = {
  purchaseId: string;
  roomVersionId: string;
  playSessionStartedAt: Date | null;
  playSessionEndedAt: Date | null;
  playSessionColyseusId: string | null;
};

export interface RoomAccessStore {
  findRoomPurchase(userId: string, roomId: string): Promise<RoomAccessPurchase | null>;
}

export type RoomAccessResult = {
  owned: boolean;
  playable: boolean;
  gameToken?: string;
  /** Presente solo en "en curso": el cliente debe unirse a esta room, no crear otra. */
  roomId?: string;
};

export function createRoomAccessService(deps: {
  store: RoomAccessStore;
  gameToken: { secret: string; ttlSeconds: number };
  now?: () => Date;
  staleAfterSeconds?: number;
}) {
  const now = deps.now ?? (() => new Date());
  const staleAfterMs = (deps.staleAfterSeconds ?? PLAY_SESSION_STALE_AFTER_SECONDS) * 1000;
  return {
    /** Sin sesión: como si no tuviera la sala (nunca revela si existe una compra ajena). */
    async getAccess(actor: Actor, roomId: string): Promise<RoomAccessResult> {
      if (isAnonymous(actor)) return { owned: false, playable: false };
      const purchase = await deps.store.findRoomPurchase(actor.userId, roomId);
      if (!purchase) return { owned: false, playable: false };
      if (purchase.playSessionEndedAt !== null) return { owned: true, playable: false };

      const inProgress =
        purchase.playSessionStartedAt !== null &&
        now().getTime() - purchase.playSessionStartedAt.getTime() <= staleAfterMs;

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
      return {
        owned: true,
        playable: true,
        gameToken,
        ...(inProgress && purchase.playSessionColyseusId
          ? { roomId: purchase.playSessionColyseusId }
          : {}),
      };
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
  playSessionEndedAt: Date | null;
  playSessionColyseusId: string | null;
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
            playSessionEndedAt: match.playSessionEndedAt,
            playSessionColyseusId: match.playSessionColyseusId,
          }
        : null;
    },
  };
}
