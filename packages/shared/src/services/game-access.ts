import type { RoomPackage } from "../schemas";

/**
 * Runtime de compras en Colyseus (B-4, auditoría 2026-09-24): lo que la
 * `GameRoom` necesita de Postgres para jugar una sala comprada, y nada más.
 *
 * **Una compra = una partida (specs/02), consumida al TERMINAR, no al
 * crear** (decisión del README, resuelta en este bloque):
 *
 * - **Paquete**: la versión exacta que el usuario compró
 *   (`purchase.roomVersionId`, del `gameToken`), nunca la última publicada.
 * - **Reclamar** (`claimPlaySession`, al crear la room): escritura
 *   condicional — solo si la compra está libre (`playSessionStartedAt IS
 *   NULL`) o su reclamación anterior está "en curso" pero caducada
 *   (`playSessionEndedAt IS NULL` y más vieja que
 *   `PLAY_SESSION_STALE_AFTER_SECONDS`: el servidor se cayó sin ejecutar
 *   `onDispose`). Dos creaciones simultáneas de la misma compra: una gana.
 * - **Consumir** (`markPlaySessionEnded`, al terminar la partida — hito
 *   `game_ended`: victoria, derrota o tiempo agotado): fija
 *   `playSessionEndedAt`. Definitivo; `claimPlaySession` nunca vuelve a
 *   aceptar esa compra.
 * - **Liberar** (`releasePlaySession`, `onDispose` de la room si la partida
 *   NO terminó — todos se fueron, se expulsó la room…): vuelve a
 *   `playSessionStartedAt`/`playSessionColyseusId` a `NULL` para que la
 *   compra se pueda reclamar de nuevo.
 *
 * Este módulo no depende de Prisma (subpath `@escaperoom/shared/game-access`):
 * la implementación sobre Postgres está en `game-access-prisma-store.ts`.
 */

/**
 * Cadencia del latido de una reclamación "en curso" (ticket duración-salas):
 * con la duración de partida ahora sin tope, una reclamación ya no puede
 * darse por "en curso pero viva" solo por la hora a la que empezó — la
 * `GameRoom` renueva la reclamación con este latido mientras la room exista
 * (`heartbeatPlaySession`), y `claimPlaySession` la considera abandonada si
 * el último latido (o el inicio, si aún no hubo ninguno) es más viejo que
 * `PLAY_SESSION_STALE_AFTER_SECONDS`.
 */
export const PLAY_SESSION_HEARTBEAT_INTERVAL_SECONDS = 5 * 60;

/**
 * Margen de una reclamación "en curso" antes de considerarla abandonada
 * (servidor caído sin `onDispose`, o sin que llegara a emitir su primer
 * latido): un múltiplo generoso de `PLAY_SESSION_HEARTBEAT_INTERVAL_SECONDS`
 * para tolerar un latido perdido sin liberar una partida que sigue viva. No
 * depende de la duración de la sala (que ya no tiene tope): antes de este
 * ticket asumía como máximo 1 h de partida (`GAME_TIME_LIMIT_SEC`) más
 * margen; con duración sin tope, esa suposición ya no vale y el latido la
 * sustituye. No hay job de limpieza: la condición vive en la propia
 * escritura de `claimPlaySession`.
 */
export const PLAY_SESSION_STALE_AFTER_SECONDS = 3 * PLAY_SESSION_HEARTBEAT_INTERVAL_SECONDS;

export interface GameAccessStore {
  /** El paquete de la versión comprada; `null` si no existe (dato inconsistente/borrado). */
  loadRoomVersionPackage(roomVersionId: string): Promise<RoomPackage | null>;
  /**
   * Reclama la partida de la compra para `colyseusRoomId`. `true` si esta
   * llamada ganó la escritura condicional (libre, o "en curso" pero
   * caducada); `false` si la compra ya está consumida (`playSessionEndedAt`)
   * o "en curso" y aún no caducada (otra room la tiene).
   */
  claimPlaySession(purchaseId: string, colyseusRoomId: string): Promise<boolean>;
  /**
   * Renueva la reclamación "en curso" (ticket duración-salas): la `GameRoom`
   * la llama cada `PLAY_SESSION_HEARTBEAT_INTERVAL_SECONDS` mientras la room
   * viva, para que una partida larga (o sin duración) nunca se considere
   * abandonada solo por el tiempo transcurrido desde que empezó. No hace
   * nada si `colyseusRoomId` ya no es quien tiene la reclamación, o si la
   * compra ya se consumió.
   */
  heartbeatPlaySession(purchaseId: string, colyseusRoomId: string): Promise<void>;
  /** Consumo definitivo: la partida terminó (`game_ended`). */
  markPlaySessionEnded(purchaseId: string): Promise<void>;
  /** Libera una reclamación de `colyseusRoomId` que no llegó a terminar. */
  releasePlaySession(purchaseId: string, colyseusRoomId: string): Promise<void>;
}

// ── Implementación en memoria (tests) ───────────────────────────────────────

export type InMemoryGameAccessPurchase = {
  id: string;
  playSessionStartedAt: Date | null;
  playSessionEndedAt: Date | null;
  playSessionColyseusId: string | null;
  playSessionHeartbeatAt: Date | null;
};

/**
 * Store en memoria (tests): `packages` por `roomVersionId` y compras con su
 * estado de partida como filas mutables. `now` inyectable para probar la
 * caducidad sin temporizadores reales.
 */
export function createInMemoryGameAccessStore(opts: {
  packages: Record<string, RoomPackage>;
  purchases: InMemoryGameAccessPurchase[];
  now?: () => Date;
  staleAfterSeconds?: number;
}): GameAccessStore & { claimedRoomIdByPurchase: Map<string, string> } {
  const now = opts.now ?? (() => new Date());
  const staleAfterMs = (opts.staleAfterSeconds ?? PLAY_SESSION_STALE_AFTER_SECONDS) * 1000;
  const claimedRoomIdByPurchase = new Map<string, string>();
  return {
    claimedRoomIdByPurchase,
    async loadRoomVersionPackage(roomVersionId) {
      const roomPackage = opts.packages[roomVersionId];
      return roomPackage ? structuredClone(roomPackage) : null;
    },
    async claimPlaySession(purchaseId, colyseusRoomId) {
      const purchase = opts.purchases.find((p) => p.id === purchaseId);
      if (!purchase || purchase.playSessionEndedAt !== null) return false;
      const lastAlive = purchase.playSessionHeartbeatAt ?? purchase.playSessionStartedAt;
      const stale = lastAlive !== null && now().getTime() - lastAlive.getTime() > staleAfterMs;
      if (purchase.playSessionStartedAt !== null && !stale) return false;
      purchase.playSessionStartedAt = now();
      purchase.playSessionHeartbeatAt = null;
      purchase.playSessionColyseusId = colyseusRoomId;
      claimedRoomIdByPurchase.set(purchaseId, colyseusRoomId);
      return true;
    },
    async heartbeatPlaySession(purchaseId, colyseusRoomId) {
      const purchase = opts.purchases.find((p) => p.id === purchaseId);
      if (
        purchase &&
        purchase.playSessionEndedAt === null &&
        purchase.playSessionColyseusId === colyseusRoomId
      ) {
        purchase.playSessionHeartbeatAt = now();
      }
    },
    async markPlaySessionEnded(purchaseId) {
      const purchase = opts.purchases.find((p) => p.id === purchaseId);
      if (purchase && purchase.playSessionEndedAt === null) purchase.playSessionEndedAt = now();
    },
    async releasePlaySession(purchaseId, colyseusRoomId) {
      const purchase = opts.purchases.find((p) => p.id === purchaseId);
      if (
        purchase &&
        purchase.playSessionEndedAt === null &&
        purchase.playSessionColyseusId === colyseusRoomId
      ) {
        purchase.playSessionStartedAt = null;
        purchase.playSessionHeartbeatAt = null;
        purchase.playSessionColyseusId = null;
      }
    },
  };
}
