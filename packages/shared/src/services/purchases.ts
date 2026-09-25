import { z } from "zod";
import { logger } from "@escaperoom/kit/logger";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { type Actor } from "./actor";
import { requireUser, splitPlatformFee } from "./common";
import type { PaymentGateway } from "./events";

/**
 * Venta individual de salas a jugadores (ticket 5.1, specs/02 §1-2, specs/13
 * §5). "Separate charges and transfers": la plataforma cobra el 100% al
 * jugador vía Stripe Checkout y, al confirmarse el pago
 * (`checkout.session.completed`), transfiere el 70% al creador con la
 * `Transfer` API — nunca `application_fee_amount`. El reparto y el
 * `stripeTransferId` se resuelven en el webhook, NO al crear la compra
 * (specs/13 §5): la fila `pending` nace con `platformFeeCents: 0` y
 * `creatorShareCents: null`.
 */

// ── Tipos de dominio ───────────────────────────────────────────────────────

export type RoomPurchaseStatus = "pending" | "succeeded" | "refunded" | "failed";

export type PurchaseRoomStatus = "draft" | "published" | "unlisted" | "archived" | "removed";

export type PurchaseVersionRef = { id: string; roomId: string };

/** Lo que el servicio necesita saber de la sala que se está comprando. */
export type PurchaseRoomRef = {
  id: string;
  authorId: string;
  title: string;
  status: PurchaseRoomStatus;
  saleIndividual: boolean;
  priceCents: number | null;
  currency: string;
};

/** Fila de `purchase` con `purchaseType = 'room'`. */
export type RoomPurchaseRow = {
  id: string;
  userId: string;
  roomVersionId: string;
  amountCents: number;
  currency: string;
  platformFeeCents: number;
  creatorShareCents: number | null;
  /** `stripePaymentIntentId`: la Checkout Session mientras está pendiente, el pago al confirmarse. */
  paymentRef: string | null;
  /** `stripeTransferId`: null hasta que se transfiere el reparto al creador. */
  transferRef: string | null;
  status: RoomPurchaseStatus;
  createdAt: Date;
};

export type NewRoomPurchase = { userId: string; roomVersionId: string; amountCents: number; currency: string };

/** Puerto de persistencia (ADR-022). */
export interface PurchaseStore {
  findVersion(versionId: string): Promise<PurchaseVersionRef | null>;
  findRoom(roomId: string): Promise<PurchaseRoomRef | null>;
  findPurchase(id: string): Promise<RoomPurchaseRow | null>;
  findPurchaseByPaymentRef(paymentRef: string): Promise<RoomPurchaseRow | null>;
  /** Compra `succeeded` de este usuario para esa versión (evita comprar dos veces). */
  findOwnedPurchase(userId: string, roomVersionId: string): Promise<RoomPurchaseRow | null>;
  /**
   * Compra `pending` con el id ya fijado y la referencia del checkout abierto
   * (`chkPurchasePaidNeedsStripe` exige referencia si `amountCents > 0`).
   */
  insertPendingPurchase(
    purchase: NewRoomPurchase & { id: string; paymentRef: string | null },
  ): Promise<RoomPurchaseRow>;
  /** Escritura condicional `pending → succeeded`; `null` si ya no estaba `pending`. */
  settlePurchase(
    purchaseId: string,
    payment: { paymentRef: string; platformFeeCents: number; creatorShareCents: number },
  ): Promise<RoomPurchaseRow | null>;
  /** Escritura condicional `pending → failed`; `null` si ya no estaba `pending`. */
  markFailed(purchaseId: string): Promise<RoomPurchaseRow | null>;
  /** Escritura condicional `succeeded → refunded`; `null` si no había compra `succeeded` con esa referencia. */
  markRefundedByPaymentRef(paymentRef: string): Promise<RoomPurchaseRow | null>;
  /** `true` si el actor es admin (para `GET /api/purchases/:id`). */
  isAdmin(userId: string): Promise<boolean>;
}

// ── Errores ────────────────────────────────────────────────────────────────

export type PurchaseErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "ROOM_VERSION_UNAVAILABLE"
  | "SALE_INDIVIDUAL_DISABLED"
  | "PURCHASE_OWN_ROOM"
  | "ALREADY_OWNED"
  | "PURCHASE_NOT_PENDING"
  | "PAYMENT_GATEWAY_UNAVAILABLE";

/** Error de dominio de compras; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class PurchaseError extends Error {
  readonly code: PurchaseErrorCode;
  readonly issues: ReadableIssue[];
  constructor(code: PurchaseErrorCode, message: string, issues: ReadableIssue[] = []) {
    super(message);
    this.name = "PurchaseError";
    this.code = code;
    this.issues = issues;
  }
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PurchaseError("VALIDATION_ERROR", "Datos no válidos", toReadableIssues(parsed.error));
  }
  return parsed.data;
}

// ── Esquemas de entrada ────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuerpo de `POST /api/purchases/room-checkout` (specs/13 §5). */
export const RoomCheckoutInput = z
  .object({ roomVersionId: z.string().regex(UUID_RE, "UUID no válido") })
  .strict();

// ── Piezas puras ───────────────────────────────────────────────────────────

const SALABLE_STATUSES: ReadonlySet<PurchaseRoomStatus> = new Set(["published", "unlisted"]);

// ── Servicio ───────────────────────────────────────────────────────────────

export type RoomCheckoutResult = { purchase: RoomPurchaseRow; checkoutUrl: string };

export function createPurchaseService(deps: {
  store: PurchaseStore;
  /** `null` hasta que 5.1 cablee Stripe: el checkout responde `PAYMENT_GATEWAY_UNAVAILABLE`. */
  payments: PaymentGateway | null;
  newId?: () => string;
}) {
  const { store } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  return {
    authorize(actor: Actor): void {
      requireUser(actor, PurchaseError);
    },

    /**
     * `POST /api/purchases/room-checkout` — `{ roomVersionId }`. Valida
     * `saleIndividual` y precio, crea la `purchase` `pending` y abre el
     * Checkout de Stripe con `metadata.purchaseId`.
     */
    async startRoomCheckout(
      actor: Actor,
      input: unknown,
      /**
       * B-21: la URL de retorno lleva `roomId` (para que
       * `checkout/confirmation` pueda enlazar la sala) y `purchaseId`. Ninguno
       * de los dos se conoce en el adaptador REST antes de resolver la sala,
       * así que el adaptador solo aporta el origen — el servicio construye la
       * URL final una vez los conoce.
       */
      buildUrls: (ctx: { purchaseId: string; roomId: string }) => {
        successUrl: string;
        cancelUrl: string;
      },
    ): Promise<RoomCheckoutResult> {
      requireUser(actor, PurchaseError);
      const data = parseOrThrow(RoomCheckoutInput, input);
      const version = await store.findVersion(data.roomVersionId);
      if (!version) throw new PurchaseError("ROOM_VERSION_UNAVAILABLE", "Versión no encontrada");
      const room = await store.findRoom(version.roomId);
      if (!room || !SALABLE_STATUSES.has(room.status)) {
        throw new PurchaseError("ROOM_VERSION_UNAVAILABLE", "La sala no tiene esa versión publicada");
      }
      if (!room.saleIndividual || room.priceCents === null) {
        throw new PurchaseError("SALE_INDIVIDUAL_DISABLED", "Esta sala no está a la venta individual");
      }
      // B-16: el autor no puede comprarse su propia sala (las licencias ya
      // tenían este guard, `LICENSE_OWN_ROOM`; la venta individual no).
      if (room.authorId === actor.userId) {
        throw new PurchaseError("PURCHASE_OWN_ROOM", "No puede comprar su propia sala");
      }
      const owned = await store.findOwnedPurchase(actor.userId, version.id);
      if (owned) throw new PurchaseError("ALREADY_OWNED", "Ya ha comprado esta sala");

      if (!deps.payments) {
        throw new PurchaseError(
          "PAYMENT_GATEWAY_UNAVAILABLE",
          "El checkout de pago todavía no está disponible",
        );
      }
      // Primero el checkout (con el id de la compra ya fijado en su metadata) y
      // luego la compra con su referencia: el CHECK de `purchase` no admite una
      // compra con importe y sin referencia de pago (mismo orden que 5.10).
      const purchaseId = newId();
      const checkout = await deps.payments.createRoomCheckout({
        purchaseId,
        buyerId: actor.userId,
        roomId: room.id,
        roomVersionId: version.id,
        title: room.title,
        amountCents: room.priceCents,
        currency: room.currency,
        ...buildUrls({ purchaseId, roomId: room.id }),
      });
      const purchase = await store.insertPendingPurchase({
        id: purchaseId,
        userId: actor.userId,
        roomVersionId: version.id,
        amountCents: room.priceCents,
        currency: room.currency,
        paymentRef: checkout.checkoutRef,
      });
      return { purchase, checkoutUrl: checkout.url };
    },

    /** `GET /api/purchases/:id` — el comprador o un admin. */
    async getPurchase(actor: Actor, id: string): Promise<RoomPurchaseRow> {
      requireUser(actor, PurchaseError);
      const purchase = UUID_RE.test(id) ? await store.findPurchase(id) : null;
      if (!purchase) throw new PurchaseError("NOT_FOUND", "Compra no encontrada");
      if (purchase.userId !== actor.userId && !(await store.isAdmin(actor.userId))) {
        throw new PurchaseError("FORBIDDEN", "No puede ver esta compra");
      }
      return purchase;
    },

    /**
     * Pago confirmado (`checkout.session.completed`, `purchase_type: 'room'`):
     * liquida la compra (reparto 70/30 resuelto aquí, specs/13 §5). Interna,
     * sin actor — la invoca el webhook de Stripe tras verificar la firma.
     * Idempotente.
     *
     * La `Transfer` del reparto al creador YA NO se intenta aquí (B-9,
     * auditoría 2026-09-24): dependía de que la cuenta Connect del creador
     * tuviera el onboarding completo, y un `createTransfer` que lanzaba dejaba
     * este método reventando dentro del webhook de Stripe (que lo reintenta
     * durante días) sin que la compra, ya `succeeded`, volviera a intentarse.
     * `@escaperoom/worker` la resuelve por su cuenta con reintentos
     * (`creator-payouts.ts`), fuera del camino crítico del webhook.
     */
    async confirmRoomCheckout(input: {
      purchaseId: string;
      paymentIntentId: string;
    }): Promise<RoomPurchaseRow> {
      const purchase = UUID_RE.test(input.purchaseId)
        ? await store.findPurchase(input.purchaseId)
        : null;
      if (!purchase) throw new PurchaseError("NOT_FOUND", "Compra no encontrada");
      if (purchase.status === "succeeded") return purchase;
      if (purchase.status !== "pending") {
        throw new PurchaseError("PURCHASE_NOT_PENDING", "La compra no está pendiente de pago");
      }

      const { platformFeeCents, creatorShareCents } = splitPlatformFee(purchase.amountCents);
      const result = await store.settlePurchase(purchase.id, {
        paymentRef: input.paymentIntentId,
        platformFeeCents,
        creatorShareCents,
      });
      if (result) return result;

      // Confirmación concurrente: otra ganó la escritura condicional.
      const current = await store.findPurchase(purchase.id);
      if (!current || current.status !== "succeeded") {
        throw new PurchaseError("PURCHASE_NOT_PENDING", "La compra no está pendiente de pago");
      }
      return current;
    },

    /** `payment_intent.payment_failed`: `pending → failed`. Interna, invocada por el webhook. */
    async markCheckoutFailed(purchaseId: string): Promise<RoomPurchaseRow | null> {
      return store.markFailed(purchaseId);
    },

    /**
     * `charge.refunded`: `succeeded → refunded` SOLO si el reembolso es total
     * (B-5); uno parcial se registra (log) pero no revoca el acceso. Si ya se
     * había transferido el reparto al creador, se revierte proporcionalmente
     * al importe reembolsado — total o parcial — para que la plataforma no
     * cargue sola con el reembolso. Interna, invocada por el webhook.
     */
    async markRefunded(input: {
      paymentIntentId: string;
      amountRefundedCents: number;
      chargeAmountCents: number;
    }): Promise<RoomPurchaseRow | null> {
      const purchase = await store.findPurchaseByPaymentRef(input.paymentIntentId);
      if (!purchase || purchase.status !== "succeeded") return null;

      const isFull = input.amountRefundedCents >= input.chargeAmountCents && input.chargeAmountCents > 0;
      if (
        deps.payments &&
        purchase.transferRef &&
        (purchase.creatorShareCents ?? 0) > 0 &&
        input.chargeAmountCents > 0
      ) {
        const proportionalCents = Math.round(
          (purchase.creatorShareCents ?? 0) * (input.amountRefundedCents / input.chargeAmountCents),
        );
        if (proportionalCents > 0) {
          await deps.payments.reverseTransfer({
            transferId: purchase.transferRef,
            amountCents: proportionalCents,
          });
        }
      }
      if (!isFull) {
        logger.warn(
          {
            purchaseId: purchase.id,
            amountRefundedCents: input.amountRefundedCents,
            chargeAmountCents: input.chargeAmountCents,
          },
          "purchases: reembolso parcial registrado; la compra sigue succeeded y el acceso no se revoca",
        );
        return purchase;
      }
      return store.markRefundedByPaymentRef(input.paymentIntentId);
    },
  };
}

export type PurchaseService = ReturnType<typeof createPurchaseService>;

// ── Implementación en memoria (tests y superficies sin base de datos) ──────

export function createInMemoryPurchaseStore(opts: {
  rooms?: PurchaseRoomRef[];
  versions?: PurchaseVersionRef[];
  adminIds?: Iterable<string>;
}): PurchaseStore & { rows: RoomPurchaseRow[] } {
  const rooms = new Map((opts.rooms ?? []).map((r) => [r.id, { ...r }]));
  const versions = new Map((opts.versions ?? []).map((v) => [v.id, { ...v }]));
  const admins = new Set(opts.adminIds ?? []);
  const rows: RoomPurchaseRow[] = [];
  let clock = Date.UTC(2026, 0, 1);
  const copy = <T>(v: T): T => structuredClone(v);

  return {
    rows,
    async findVersion(versionId) {
      const v = versions.get(versionId);
      return v ? { ...v } : null;
    },
    async findRoom(roomId) {
      const r = rooms.get(roomId);
      return r ? { ...r } : null;
    },
    async findPurchase(id) {
      const found = rows.find((p) => p.id === id);
      return found ? copy(found) : null;
    },
    async findPurchaseByPaymentRef(paymentRef) {
      const found = rows.find((p) => p.paymentRef === paymentRef);
      return found ? copy(found) : null;
    },
    async findOwnedPurchase(userId, roomVersionId) {
      const found = rows.find(
        (p) => p.userId === userId && p.roomVersionId === roomVersionId && p.status === "succeeded",
      );
      return found ? copy(found) : null;
    },
    async insertPendingPurchase(purchase) {
      if (purchase.amountCents > 0 && !purchase.paymentRef) {
        throw new Error("CHECK chkPurchasePaidNeedsStripe violado");
      }
      const row: RoomPurchaseRow = {
        ...purchase,
        paymentRef: purchase.paymentRef,
        transferRef: null,
        platformFeeCents: 0,
        creatorShareCents: null,
        status: "pending",
        createdAt: new Date((clock += 1000)),
      };
      rows.push(row);
      return copy(row);
    },
    async settlePurchase(purchaseId, payment) {
      const row = rows.find((p) => p.id === purchaseId);
      if (!row || row.status !== "pending") return null;
      row.status = "succeeded";
      row.paymentRef = payment.paymentRef;
      row.platformFeeCents = payment.platformFeeCents;
      row.creatorShareCents = payment.creatorShareCents;
      return copy(row);
    },
    async markFailed(purchaseId) {
      const row = rows.find((p) => p.id === purchaseId);
      if (!row || row.status !== "pending") return null;
      row.status = "failed";
      return copy(row);
    },
    async markRefundedByPaymentRef(paymentRef) {
      const row = rows.find((p) => p.paymentRef === paymentRef);
      if (!row || row.status !== "succeeded") return null;
      row.status = "refunded";
      return copy(row);
    },
    async isAdmin(userId) {
      return admins.has(userId);
    },
  };
}
