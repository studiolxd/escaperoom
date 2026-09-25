import { logger } from "@escaperoom/kit/logger";
import type { ConnectGateway } from "./creator-connect";
import type { PaymentGateway } from "./events";

/**
 * Transferencia del reparto (70 %) a creadores tras una venta individual
 * (`room`) o una licencia entre creadores (`room_license`), FUERA del camino
 * crítico del webhook de Stripe (auditoría 2026-09-24, B-9).
 *
 * Antes, `confirmRoomCheckout`/`confirmLicensePayment` intentaban la
 * `Transfer` en el mismo request que liquidaba el pago: si la cuenta Connect
 * del creador no tenía el onboarding completo (`getAccountStatus`), o
 * `createTransfer` lanzaba por cualquier otro motivo, el webhook respondía
 * 500 y Stripe lo reintentaba durante días — sin que la compra, ya
 * `succeeded`, se beneficiara de ese reintento (el email de confirmación
 * tampoco se encolaba, porque nunca se llegaba a esa línea).
 *
 * Este barrido periódico (mismo patrón que `purchase-confirmation-outbox`)
 * recoge cualquier compra `succeeded` con reparto pendiente
 * (`stripeTransferId IS NULL`) y reintenta la transferencia con
 * `PaymentGateway.createTransfer`, que ya es idempotente por `purchaseId`
 * (B-3: `idempotencyKey` + `transfers.list({transfer_group})` antes de crear).
 *
 * Anti-inanición (revisión de PR #135): `findPendingPayouts` ordenaba por
 * `createdAt ASC` con `take: limit`. Una compra cuyo creador nunca completa
 * el onboarding de Connect se queda `skipped` para siempre en cabeza de esa
 * cola — con más de `limit` compras así por delante, las compras NUEVAS de
 * creadores con la cuenta ya lista nunca llegan ni a intentarse. `payoutAttemptAt`
 * (el instante del último intento; `NULL` si nunca se ha intentado) se
 * actualiza en cada intento, transferido o no, y el store ordena por
 * `payoutAttemptAt NULLS FIRST, createdAt ASC`: lo nunca intentado (o lo
 * intentado hace más tiempo) siempre entra antes que lo bloqueado que ya
 * ocupó un hueco en el barrido anterior.
 */

export type CreatorPurchaseType = "room" | "room_license";

export type PendingCreatorPayout = {
  purchaseId: string;
  purchaseType: CreatorPurchaseType;
  /** `creatorShareCents` congelado al liquidar la compra. */
  amountCents: number;
  currency: string;
  /** El pago real (`stripePaymentIntentId` tras liquidarse), para `source_transaction`. */
  paymentIntentId: string;
  roomVersionId: string;
  createdAt: Date;
};

export type CreatorPayoutAccount = { stripeAccountId: string | null };

/** Puerto de persistencia (ADR-022). */
export interface CreatorPayoutStore {
  /**
   * Compras `succeeded` con reparto pendiente, ordenadas por
   * `payoutAttemptAt NULLS FIRST, createdAt ASC` (nunca solo `createdAt`,
   * ver cabecera del módulo: evita que una compra bloqueada acapare la cola).
   */
  findPendingPayouts(limit: number): Promise<PendingCreatorPayout[]>;
  /** Cuenta conectada del creador de origen de esa versión (autor de la sala). */
  findCreatorAccountForVersion(roomVersionId: string): Promise<CreatorPayoutAccount | null>;
  /** Escritura condicional `stripeTransferId IS NULL → transferId`; `true` si escribió. */
  attachTransfer(purchaseId: string, transferId: string): Promise<boolean>;
  /** Marca el instante de este intento (transferido o no): rota la posición en la cola. */
  markAttempted(purchaseId: string, at: Date): Promise<void>;
}

export type CreatorPayoutSweepResult = {
  attempted: number;
  transferred: number;
  /** Sin cuenta conectada, onboarding incompleto, o ya transferida (carrera). */
  skipped: number;
  failed: number;
};

/** Compras bloqueadas más de este margen sin poder pagarse: se avisan por si requieren revisión manual. */
const DEFAULT_STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** Una pasada del barrido; nunca lanza — cada fallo se registra y se reintenta en la siguiente. */
export async function processCreatorPayouts(
  deps: { store: CreatorPayoutStore; connect: ConnectGateway; payments: PaymentGateway },
  opts: { limit?: number; staleAfterMs?: number; now?: Date } = {},
): Promise<CreatorPayoutSweepResult> {
  const now = opts.now ?? new Date();
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const pending = await deps.store.findPendingPayouts(opts.limit ?? 100);
  let transferred = 0;
  let skipped = 0;
  let failed = 0;
  const stale: PendingCreatorPayout[] = [];

  for (const payout of pending) {
    const isStale = now.getTime() - payout.createdAt.getTime() > staleAfterMs;
    try {
      const account = await deps.store.findCreatorAccountForVersion(payout.roomVersionId);
      if (!account?.stripeAccountId) {
        await deps.store.markAttempted(payout.purchaseId, now);
        skipped++;
        if (isStale) stale.push(payout);
        continue;
      }
      const status = await deps.connect.getAccountStatus(account.stripeAccountId);
      if (status !== "complete") {
        await deps.store.markAttempted(payout.purchaseId, now);
        skipped++;
        if (isStale) stale.push(payout);
        continue;
      }
      const transfer = await deps.payments.createTransfer({
        purchaseId: payout.purchaseId,
        amountCents: payout.amountCents,
        currency: payout.currency,
        destinationAccountId: account.stripeAccountId,
        paymentIntentId: payout.paymentIntentId,
      });
      if (await deps.store.attachTransfer(payout.purchaseId, transfer.transferId)) {
        transferred++;
      } else {
        // Otra pasada concurrente ya la adjuntó primero: no es un fallo.
        await deps.store.markAttempted(payout.purchaseId, now);
        skipped++;
      }
    } catch (err) {
      await deps.store.markAttempted(payout.purchaseId, now).catch(() => undefined);
      failed++;
      if (isStale) stale.push(payout);
      logger.warn(
        { err, purchaseId: payout.purchaseId, purchaseType: payout.purchaseType },
        "creator payouts: fallo transfiriendo el reparto; se reintenta en el próximo barrido",
      );
    }
  }

  if (failed > 0) {
    logger.error(
      { attempted: pending.length, transferred, skipped, failed },
      "creator payouts: una o más transferencias fallaron en este barrido",
    );
  }
  if (stale.length > 0) {
    logger.warn(
      {
        staleAfterMs,
        purchases: stale.map((p) => ({ purchaseId: p.purchaseId, purchaseType: p.purchaseType, createdAt: p.createdAt })),
      },
      "creator payouts: compras que llevan más del margen sin poder pagarse (creador sin onboarding completo); requieren revisión manual",
    );
  }
  return { attempted: pending.length, transferred, skipped, failed };
}

// ── Implementación en memoria (tests) ───────────────────────────────────────

export function createInMemoryCreatorPayoutStore(opts: {
  payouts?: PendingCreatorPayout[];
  /** `stripeAccountId` de cada versión (por `roomVersionId`). */
  accounts?: Record<string, string>;
}): CreatorPayoutStore & { transferred: Map<string, string>; attempts: Map<string, Date> } {
  const payouts = [...(opts.payouts ?? [])];
  const accounts = new Map(Object.entries(opts.accounts ?? {}));
  const transferred = new Map<string, string>();
  const attempts = new Map<string, Date>();
  return {
    transferred,
    attempts,
    async findPendingPayouts(limit) {
      return payouts
        .filter((p) => !transferred.has(p.purchaseId))
        .sort((a, b) => {
          const attemptA = attempts.get(a.purchaseId)?.getTime() ?? -Infinity;
          const attemptB = attempts.get(b.purchaseId)?.getTime() ?? -Infinity;
          return attemptA - attemptB || a.createdAt.getTime() - b.createdAt.getTime();
        })
        .slice(0, limit);
    },
    async findCreatorAccountForVersion(roomVersionId) {
      return { stripeAccountId: accounts.get(roomVersionId) ?? null };
    },
    async attachTransfer(purchaseId, transferId) {
      if (transferred.has(purchaseId)) return false;
      transferred.set(purchaseId, transferId);
      return true;
    },
    async markAttempted(purchaseId, at) {
      attempts.set(purchaseId, at);
    },
  };
}
