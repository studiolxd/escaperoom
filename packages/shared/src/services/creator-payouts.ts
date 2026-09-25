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
};

export type CreatorPayoutAccount = { stripeAccountId: string | null };

/** Puerto de persistencia (ADR-022). */
export interface CreatorPayoutStore {
  /** Compras `succeeded` con reparto pendiente, más antiguas primero. */
  findPendingPayouts(limit: number): Promise<PendingCreatorPayout[]>;
  /** Cuenta conectada del creador de origen de esa versión (autor de la sala). */
  findCreatorAccountForVersion(roomVersionId: string): Promise<CreatorPayoutAccount | null>;
  /** Escritura condicional `stripeTransferId IS NULL → transferId`; `true` si escribió. */
  attachTransfer(purchaseId: string, transferId: string): Promise<boolean>;
}

export type CreatorPayoutSweepResult = {
  attempted: number;
  transferred: number;
  /** Sin cuenta conectada, onboarding incompleto, o ya transferida (carrera). */
  skipped: number;
  failed: number;
};

/** Una pasada del barrido; nunca lanza — cada fallo se registra y se reintenta en la siguiente. */
export async function processCreatorPayouts(
  deps: { store: CreatorPayoutStore; connect: ConnectGateway; payments: PaymentGateway },
  opts: { limit?: number } = {},
): Promise<CreatorPayoutSweepResult> {
  const pending = await deps.store.findPendingPayouts(opts.limit ?? 100);
  let transferred = 0;
  let skipped = 0;
  let failed = 0;

  for (const payout of pending) {
    try {
      const account = await deps.store.findCreatorAccountForVersion(payout.roomVersionId);
      if (!account?.stripeAccountId) {
        skipped++;
        continue;
      }
      const status = await deps.connect.getAccountStatus(account.stripeAccountId);
      if (status !== "complete") {
        skipped++;
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
        skipped++;
      }
    } catch (err) {
      failed++;
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
  return { attempted: pending.length, transferred, skipped, failed };
}

// ── Implementación en memoria (tests) ───────────────────────────────────────

export function createInMemoryCreatorPayoutStore(opts: {
  payouts?: PendingCreatorPayout[];
  /** `stripeAccountId` de cada versión (por `roomVersionId`). */
  accounts?: Record<string, string>;
}): CreatorPayoutStore & { transferred: Map<string, string> } {
  const payouts = [...(opts.payouts ?? [])];
  const accounts = new Map(Object.entries(opts.accounts ?? {}));
  const transferred = new Map<string, string>();
  return {
    transferred,
    async findPendingPayouts(limit) {
      return payouts.filter((p) => !transferred.has(p.purchaseId)).slice(0, limit);
    },
    async findCreatorAccountForVersion(roomVersionId) {
      return { stripeAccountId: accounts.get(roomVersionId) ?? null };
    },
    async attachTransfer(purchaseId, transferId) {
      if (transferred.has(purchaseId)) return false;
      transferred.set(purchaseId, transferId);
      return true;
    },
  };
}
