import { z } from "zod";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { isAnonymous, type Actor } from "./actor";
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

export const ROOM_PLATFORM_FEE_RATE = 0.3;

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

/** Cuenta conectada del creador de una versión, para el destino de la `Transfer`. */
export type PurchaseCreatorAccount = { authorId: string; stripeAccountId: string | null };

/** Puerto de persistencia (ADR-022). */
export interface PurchaseStore {
  findVersion(versionId: string): Promise<PurchaseVersionRef | null>;
  findRoom(roomId: string): Promise<PurchaseRoomRef | null>;
  findPurchase(id: string): Promise<RoomPurchaseRow | null>;
  findPurchaseByPaymentRef(paymentRef: string): Promise<RoomPurchaseRow | null>;
  /** Compra `succeeded` de este usuario para esa versión (evita comprar dos veces). */
  findOwnedPurchase(userId: string, roomVersionId: string): Promise<RoomPurchaseRow | null>;
  findCreatorAccountForVersion(roomVersionId: string): Promise<PurchaseCreatorAccount | null>;
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
  /** Adjunta la `Transfer` ya creada; `null` si la compra ya no existe. */
  attachTransfer(purchaseId: string, transferRef: string): Promise<RoomPurchaseRow | null>;
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

/** Reparto de una venta individual: 30 % plataforma (redondeado), resto al creador. */
export function splitRoomAmount(amountCents: number): {
  platformFeeCents: number;
  creatorShareCents: number;
} {
  const platformFeeCents = Math.round(amountCents * ROOM_PLATFORM_FEE_RATE);
  return { platformFeeCents, creatorShareCents: amountCents - platformFeeCents };
}

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

  function requireUser(actor: Actor): void {
    if (isAnonymous(actor)) throw new PurchaseError("UNAUTHORIZED", "No hay sesión");
  }

  return {
    authorize(actor: Actor): void {
      requireUser(actor);
    },

    /**
     * `POST /api/purchases/room-checkout` — `{ roomVersionId }`. Valida
     * `saleIndividual` y precio, crea la `purchase` `pending` y abre el
     * Checkout de Stripe con `metadata.purchaseId`.
     */
    async startRoomCheckout(
      actor: Actor,
      input: unknown,
      urls: { successUrl: string; cancelUrl: string },
    ): Promise<RoomCheckoutResult> {
      requireUser(actor);
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
        ...urls,
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
      requireUser(actor);
      const purchase = UUID_RE.test(id) ? await store.findPurchase(id) : null;
      if (!purchase) throw new PurchaseError("NOT_FOUND", "Compra no encontrada");
      if (purchase.userId !== actor.userId && !(await store.isAdmin(actor.userId))) {
        throw new PurchaseError("FORBIDDEN", "No puede ver esta compra");
      }
      return purchase;
    },

    /**
     * Pago confirmado (`checkout.session.completed`, `purchase_type: 'room'`):
     * liquida la compra (reparto 70/30 resuelto aquí, specs/13 §5) y transfiere
     * el reparto al creador si ya completó el onboarding de Connect.
     * Interna, sin actor — la invoca el webhook de Stripe tras verificar la
     * firma. Idempotente: una segunda confirmación no repite la transferencia.
     */
    async confirmRoomCheckout(input: {
      purchaseId: string;
      paymentIntentId: string;
    }): Promise<RoomPurchaseRow> {
      const purchase = UUID_RE.test(input.purchaseId)
        ? await store.findPurchase(input.purchaseId)
        : null;
      if (!purchase) throw new PurchaseError("NOT_FOUND", "Compra no encontrada");

      let settled = purchase;
      if (purchase.status === "pending") {
        const { platformFeeCents, creatorShareCents } = splitRoomAmount(purchase.amountCents);
        const result = await store.settlePurchase(purchase.id, {
          paymentRef: input.paymentIntentId,
          platformFeeCents,
          creatorShareCents,
        });
        if (result) {
          settled = result;
        } else {
          // Confirmación concurrente: otra ganó la escritura condicional.
          const current = await store.findPurchase(purchase.id);
          if (!current || current.status !== "succeeded") {
            throw new PurchaseError("PURCHASE_NOT_PENDING", "La compra no está pendiente de pago");
          }
          settled = current;
        }
      } else if (purchase.status !== "succeeded") {
        throw new PurchaseError("PURCHASE_NOT_PENDING", "La compra no está pendiente de pago");
      }

      // Reparto ya transferido (replay del webhook): nada más que hacer.
      if (settled.transferRef || !deps.payments) return settled;

      const creator = await store.findCreatorAccountForVersion(settled.roomVersionId);
      // Sin cuenta conectada (el creador no ha hecho el onboarding todavía): la
      // compra queda `succeeded` sin transferir; el reparto pendiente se
      // resuelve en una iteración posterior (reintento manual/job).
      if (!creator?.stripeAccountId || (settled.creatorShareCents ?? 0) <= 0) return settled;

      const transfer = await deps.payments.createTransfer({
        purchaseId: settled.id,
        amountCents: settled.creatorShareCents ?? 0,
        currency: settled.currency,
        destinationAccountId: creator.stripeAccountId,
        paymentIntentId: input.paymentIntentId,
      });
      const withTransfer = await store.attachTransfer(settled.id, transfer.transferId);
      return withTransfer ?? settled;
    },

    /** `payment_intent.payment_failed`: `pending → failed`. Interna, invocada por el webhook. */
    async markCheckoutFailed(purchaseId: string): Promise<RoomPurchaseRow | null> {
      return store.markFailed(purchaseId);
    },

    /** `charge.refunded`: `succeeded → refunded`. Interna, invocada por el webhook. */
    async markRefunded(paymentIntentId: string): Promise<RoomPurchaseRow | null> {
      return store.markRefundedByPaymentRef(paymentIntentId);
    },
  };
}

export type PurchaseService = ReturnType<typeof createPurchaseService>;

// ── Implementación en memoria (tests y superficies sin base de datos) ──────

export function createInMemoryPurchaseStore(opts: {
  rooms?: PurchaseRoomRef[];
  versions?: PurchaseVersionRef[];
  adminIds?: Iterable<string>;
  /** `user.stripeAccountId` de cada autor, por `authorId` (por defecto, sin cuenta). */
  connectedAccounts?: Record<string, string>;
}): PurchaseStore & { rows: RoomPurchaseRow[] } {
  const rooms = new Map((opts.rooms ?? []).map((r) => [r.id, { ...r }]));
  const versions = new Map((opts.versions ?? []).map((v) => [v.id, { ...v }]));
  const admins = new Set(opts.adminIds ?? []);
  const connectedAccounts = new Map(Object.entries(opts.connectedAccounts ?? {}));
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
    async findCreatorAccountForVersion(roomVersionId) {
      const version = versions.get(roomVersionId);
      if (!version) return null;
      const room = rooms.get(version.roomId);
      if (!room) return null;
      return { authorId: room.authorId, stripeAccountId: connectedAccounts.get(room.authorId) ?? null };
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
    async attachTransfer(purchaseId, transferRef) {
      const row = rows.find((p) => p.id === purchaseId);
      if (!row) return null;
      row.transferRef = transferRef;
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
