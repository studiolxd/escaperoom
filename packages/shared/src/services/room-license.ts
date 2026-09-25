import * as Y from "yjs";
import { z } from "zod";
import type { RoomPackage } from "../schemas";
import { toReadableIssues, type ReadableIssue } from "../schemas/errors";
import { type Actor } from "./actor";
import { requireUser, splitPlatformFee } from "./common";
import type { PaymentGateway } from "./events";

/**
 * Licencias de salas entre creadores (ticket 5.10, specs/02 §5, specs/13 §4).
 *
 * Un creador obtiene una copia editable y SUYA de una versión publicada de la
 * sala de otro, por dos vías:
 *
 * - **Compra** (`license-checkout`): la sala debe ser `licensable` con
 *   `licensePriceCents`. Se crea una `purchase` `room_license` pendiente y se
 *   abre el pago en el MISMO puerto `PaymentGateway` de 5.4 (Stripe es de 5.1).
 *   El fork solo nace cuando el pago se confirma (`confirmLicensePayment`, que
 *   invocará el webhook de 5.1). Una licencia a precio 0 se resuelve al momento.
 * - **Regalo** (`gift-copy`): el autor envía una copia gratuita a otro creador
 *   por email. Sin checkout, fork inmediato y `purchase` a precio 0.
 *
 * El fork es una sala NUEVA en `draft`, propiedad del receptor, con linaje
 * `forkedFromRoomId`/`forkedFromVersionId`. Su draft Yjs se siembra con el
 * `package` congelado de la versión (vía el puerto `RoomPackageDocBuilder`,
 * `roomPackageToDoc` de 3.1) como primer `roomUpdate`: a partir de ahí es un
 * doc independiente, así que editar el original no toca el fork ni al revés, y
 * la `roomVersion` de origen es inmutable (3.9).
 *
 * Los assets publicados (`r2://assets/rooms/<origen>/…`, direccionados por
 * contenido e inmutables) se REFERENCIAN tal cual, no se copian: la
 * publicación del fork solo empaqueta referencias `library:`/`upload:`.
 */

// ── Tipos de dominio ───────────────────────────────────────────────────────

export type LicenseRoomStatus = "draft" | "published" | "unlisted" | "archived" | "removed";

/** Lo que el servicio necesita saber de la sala de origen. */
export type LicenseRoomRef = {
  id: string;
  authorId: string;
  title: string;
  status: LicenseRoomStatus;
  licensable: boolean;
  licensePriceCents: number | null;
  currency: string;
};

/** Versión publicada con su `package` congelado. */
export type LicenseVersionRef = {
  id: string;
  roomId: string;
  semver: string;
  package: RoomPackage;
};

/**
 * B-24: igual que `LicenseVersionRef` pero sin `package` — evita cargar el
 * JSONB completo cuando solo hace falta validar la versión (comprobar que
 * pertenece a la sala) y anotar su id, no forkearla.
 */
export type LicenseVersionInfo = {
  id: string;
  roomId: string;
  semver: string;
};

export type LicensePurchaseStatus = "pending" | "succeeded" | "refunded" | "failed";

/** Fila de `purchase` con `purchaseType = 'room_license'`. */
export type LicensePurchaseRow = {
  id: string;
  /** Comprador o receptor del regalo: el dueño del fork. */
  userId: string;
  roomVersionId: string;
  resultingRoomId: string | null;
  amountCents: number;
  currency: string;
  platformFeeCents: number;
  creatorShareCents: number | null;
  /**
   * Referencia en la pasarela: la del checkout mientras está `pending` y la del
   * pago al confirmarse (`null` a precio 0). Columna `stripePaymentIntentId`.
   */
  paymentRef: string | null;
  /** `stripeTransferId`: null hasta que se transfiere el reparto al creador origen. */
  transferRef: string | null;
  status: LicensePurchaseStatus;
  createdAt: Date;
};

export type NewLicensePurchase = Omit<
  LicensePurchaseRow,
  "id" | "createdAt" | "resultingRoomId" | "paymentRef" | "transferRef" | "status"
>;

/** Sala nueva del fork (el id lo fija el servicio para sembrar `meta.id`). */
export type NewForkRoom = {
  id: string;
  authorId: string;
  title: string;
  currency: string;
  forkedFromRoomId: string;
  forkedFromVersionId: string;
};

/** Fila de la sala del fork tal y como queda creada. */
export type ForkRoomRow = NewForkRoom & { status: LicenseRoomStatus; createdAt: Date };

/** Cómo se liquida la `purchase` al crear el fork. */
export type ForkPurchaseSettlement =
  /** Regalo o licencia gratuita: la compra nace ya `succeeded`. */
  | { kind: "insert"; purchase: NewLicensePurchase }
  /** Pago confirmado: `pending → succeeded` (escritura condicional). */
  | { kind: "settle"; purchaseId: string; paymentRef: string };

/** Puerto de persistencia de licencias (ADR-022). */
export interface RoomLicenseStore {
  /** Usuario por email (sin distinguir mayúsculas), o `null`. */
  findUserIdByEmail(email: string): Promise<string | null>;
  /** Sala viva (sin `deletedAt`). */
  findRoom(roomId: string): Promise<LicenseRoomRef | null>;
  /** Última versión publicada de la sala. */
  findLatestVersion(roomId: string): Promise<LicenseVersionRef | null>;
  /** Versión por id (aunque la sala se haya borrado después: ya se pagó). */
  findVersion(versionId: string): Promise<LicenseVersionRef | null>;
  /** B-24: igual que las dos anteriores pero sin cargar `package` (JSONB). */
  findLatestVersionRef(roomId: string): Promise<LicenseVersionInfo | null>;
  findVersionRef(versionId: string): Promise<LicenseVersionInfo | null>;
  findPurchase(id: string): Promise<LicensePurchaseRow | null>;
  /** Sala nacida de un fork (con su linaje), o `null`. */
  findForkRoom(roomId: string): Promise<ForkRoomRow | null>;
  /** Licencia ya obtenida (`succeeded`) por el usuario para esa versión. */
  findOwnedLicense(userId: string, roomVersionId: string): Promise<LicensePurchaseRow | null>;
  /** Escritura condicional `pending → failed`; `null` si ya no estaba `pending`. */
  markFailed(purchaseId: string): Promise<LicensePurchaseRow | null>;
  /** La compra `succeeded` con esa referencia de pago (para `charge.refunded`, B-5). */
  findPurchaseByPaymentRef(paymentRef: string): Promise<LicensePurchaseRow | null>;
  /** Escritura condicional `succeeded → refunded`; `null` si no había compra `succeeded` con esa referencia. */
  markRefundedByPaymentRef(paymentRef: string): Promise<LicensePurchaseRow | null>;
  /**
   * Compra `pending` con el id ya fijado y la referencia del checkout abierto
   * (`chkPurchasePaidNeedsStripe` exige referencia de pago si `amountCents > 0`).
   */
  insertPendingPurchase(
    purchase: NewLicensePurchase & { id: string; paymentRef: string },
  ): Promise<LicensePurchaseRow>;
  /**
   * En UNA transacción: crea la sala del fork en `draft`, su primer
   * `roomUpdate` (`initialUpdate`, autor = dueño) y liquida la compra con
   * `resultingRoomId`. Con `settle`, si la compra ya no está `pending`
   * (confirmación duplicada o concurrente) no escribe nada y devuelve `null`.
   */
  createFork(input: {
    room: NewForkRoom;
    initialUpdate: Uint8Array;
    settlement: ForkPurchaseSettlement;
  }): Promise<{ room: ForkRoomRow; purchase: LicensePurchaseRow } | null>;
}

/**
 * `RoomPackage` → doc Yjs de la sala. **Web lo cablea a `roomPackageToDoc`**
 * (3.1): `shared` no conoce el layout del doc. Debe ser puro y devolver un doc
 * nuevo (el servicio lo destruye tras codificarlo).
 */
export type RoomPackageDocBuilder = (pkg: RoomPackage) => Y.Doc;

// ── Errores ────────────────────────────────────────────────────────────────

export type RoomLicenseErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RECIPIENT_NOT_FOUND"
  | "INVALID_RECIPIENT"
  | "LICENSE_NOT_AVAILABLE"
  | "ROOM_VERSION_UNAVAILABLE"
  | "LICENSE_OWN_ROOM"
  | "LICENSE_ALREADY_OWNED"
  | "PURCHASE_NOT_PENDING"
  | "PAYMENT_GATEWAY_UNAVAILABLE";

/** Error de dominio de licencias; los adaptadores lo traducen a HTTP/tRPC/MCP. */
export class RoomLicenseError extends Error {
  readonly code: RoomLicenseErrorCode;
  readonly issues: ReadableIssue[];
  /** Sala del fork ya existente (`LICENSE_ALREADY_OWNED`). */
  readonly resultingRoomId: string | null;
  constructor(
    code: RoomLicenseErrorCode,
    message: string,
    opts: { issues?: ReadableIssue[]; resultingRoomId?: string | null } = {},
  ) {
    super(message);
    this.name = "RoomLicenseError";
    this.code = code;
    this.issues = opts.issues ?? [];
    this.resultingRoomId = opts.resultingRoomId ?? null;
  }
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new RoomLicenseError("VALIDATION_ERROR", "Datos no válidos", {
      issues: toReadableIssues(parsed.error),
    });
  }
  return parsed.data;
}

// ── Esquemas de entrada ────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roomVersionId = z.string().regex(UUID_RE, "UUID no válido").optional();

/** Cuerpo de `POST /api/rooms/:roomId/license-checkout` (vacío = última versión). */
export const LicenseCheckoutInput = z.object({ roomVersionId }).strict();

/** Cuerpo de `POST /api/rooms/:roomId/gift-copy`. */
export const GiftCopyInput = z
  .object({ recipientEmail: z.string().trim().toLowerCase().pipe(z.email()), roomVersionId })
  .strict();

// ── Piezas puras ───────────────────────────────────────────────────────────

/**
 * Primer update Yjs del draft del fork: el `package` congelado con `meta.id` y
 * `meta.authorId` del fork (la publicación los vuelve a fijar igualmente). El
 * resto del paquete, incluidas las referencias `r2://` a assets, va tal cual.
 */
export function buildForkSeedUpdate(
  buildDoc: RoomPackageDocBuilder,
  pkg: RoomPackage,
  fork: { roomId: string; authorId: string },
): Uint8Array {
  const seeded: RoomPackage = {
    ...structuredClone(pkg),
    meta: { ...structuredClone(pkg.meta), id: fork.roomId, authorId: fork.authorId },
  };
  const doc = buildDoc(seeded);
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

// ── Servicio ───────────────────────────────────────────────────────────────

/** Resultado de un fork: la sala nueva y la compra que la originó. */
export type ForkResult = { room: ForkRoomRow; purchase: LicensePurchaseRow };

/** Resultado de `license-checkout`: pago abierto o, a precio 0, fork hecho. */
export type LicenseCheckoutResult =
  | { status: "pending"; purchase: LicensePurchaseRow; checkoutUrl: string }
  | ({ status: "succeeded" } & ForkResult);

/** Salas sobre las que se puede comprar una licencia. */
const LICENSABLE_STATUSES: ReadonlySet<LicenseRoomStatus> = new Set(["published", "unlisted"]);

export function createRoomLicenseService(deps: {
  store: RoomLicenseStore;
  /** `roomPackageToDoc` de 3.1 en web; en tests, cualquier builder puro. */
  buildDoc: RoomPackageDocBuilder;
  /** `null` hasta que 5.1 cablee Stripe: el checkout de pago responde `PAYMENT_GATEWAY_UNAVAILABLE`. */
  payments: PaymentGateway | null;
  newId?: () => string;
}) {
  const { store } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function findRoom(roomId: string): Promise<LicenseRoomRef> {
    const room = UUID_RE.test(roomId) ? await store.findRoom(roomId) : null;
    if (!room) throw new RoomLicenseError("NOT_FOUND", "Sala no encontrada");
    return room;
  }

  /** Versión pedida (de ESTA sala) o la última publicada. */
  async function resolveVersion(
    room: LicenseRoomRef,
    versionId: string | undefined,
  ): Promise<LicenseVersionRef> {
    const version =
      versionId === undefined
        ? await store.findLatestVersion(room.id)
        : await store.findVersion(versionId);
    if (!version || version.roomId !== room.id) {
      throw new RoomLicenseError(
        "ROOM_VERSION_UNAVAILABLE",
        "La sala no tiene esa versión publicada",
      );
    }
    return version;
  }

  /**
   * B-24: igual que `resolveVersion` pero sin cargar `package` — para
   * `startLicenseCheckout` con precio > 0, que solo necesita el id de la
   * versión (nunca la forkea ahí: eso lo hace `confirmLicensePayment` al
   * confirmarse el pago, con su propio `store.findVersion`).
   */
  async function resolveVersionRef(
    room: LicenseRoomRef,
    versionId: string | undefined,
  ): Promise<LicenseVersionInfo> {
    const version =
      versionId === undefined
        ? await store.findLatestVersionRef(room.id)
        : await store.findVersionRef(versionId);
    if (!version || version.roomId !== room.id) {
      throw new RoomLicenseError(
        "ROOM_VERSION_UNAVAILABLE",
        "La sala no tiene esa versión publicada",
      );
    }
    return version;
  }

  async function assertNotOwned(userId: string, versionId: string): Promise<void> {
    const owned = await store.findOwnedLicense(userId, versionId);
    if (owned) {
      throw new RoomLicenseError(
        "LICENSE_ALREADY_OWNED",
        "Ya tiene una copia de esta versión de la sala",
        { resultingRoomId: owned.resultingRoomId },
      );
    }
  }

  function forkRoom(
    origin: { id: string; title: string; currency: string },
    version: LicenseVersionRef,
    ownerId: string,
  ): { room: NewForkRoom; initialUpdate: Uint8Array } {
    const id = newId();
    return {
      room: {
        id,
        authorId: ownerId,
        title: origin.title,
        currency: origin.currency,
        forkedFromRoomId: origin.id,
        forkedFromVersionId: version.id,
      },
      initialUpdate: buildForkSeedUpdate(deps.buildDoc, version.package, {
        roomId: id,
        authorId: ownerId,
      }),
    };
  }

  /** Fork inmediato con la compra ya liquidada (regalo o licencia gratuita). */
  async function forkNow(
    origin: LicenseRoomRef,
    version: LicenseVersionRef,
    ownerId: string,
    amountCents: number,
  ): Promise<ForkResult> {
    const result = await store.createFork({
      ...forkRoom(origin, version, ownerId),
      settlement: {
        kind: "insert",
        purchase: {
          userId: ownerId,
          roomVersionId: version.id,
          amountCents,
          currency: origin.currency,
          ...splitPlatformFee(amountCents),
        },
      },
    });
    // `insert` nunca devuelve `null` (no hay escritura condicional).
    if (!result) throw new Error("createFork(insert) no devolvió la sala");
    return result;
  }

  return {
    /** Solo el guard de sesión (los adaptadores lo usan antes de leer el cuerpo). */
    authorize(actor: Actor): void {
      requireUser(actor, RoomLicenseError);
    },

    /**
     * `POST /api/rooms/:roomId/license-checkout` — compra la licencia de la
     * sala de otro creador. Con precio > 0 crea la `purchase` pendiente y abre
     * el pago; el fork NO se crea hasta `confirmLicensePayment`. A precio 0 el
     * fork es inmediato.
     */
    async startLicenseCheckout(
      actor: Actor,
      roomId: string,
      input: unknown = {},
      /** Solo hace falta con precio > 0 (B-21): a precio 0 el fork es inmediato, sin checkout. */
      urls?: { successUrl: string; cancelUrl: string },
    ): Promise<LicenseCheckoutResult> {
      requireUser(actor, RoomLicenseError);
      const data = parseOrThrow(LicenseCheckoutInput, input ?? {});
      const room = await findRoom(roomId);
      // Una sala sin publicar o retirada por moderación no existe para terceros.
      if (room.status === "draft" || room.status === "removed") {
        throw new RoomLicenseError("NOT_FOUND", "Sala no encontrada");
      }
      if (room.authorId === actor.userId) {
        throw new RoomLicenseError(
          "LICENSE_OWN_ROOM",
          "No puede comprar la licencia de su propia sala",
        );
      }
      if (
        !room.licensable ||
        room.licensePriceCents === null ||
        !LICENSABLE_STATUSES.has(room.status)
      ) {
        throw new RoomLicenseError(
          "LICENSE_NOT_AVAILABLE",
          "El autor no ofrece esta sala como licencia para otros creadores",
        );
      }
      // B-24: versión "ligera" (sin `package`) para validar y anotar el id;
      // el JSONB completo solo hace falta si se va a forkear al momento
      // (precio 0), no en el camino de pago (abajo).
      const versionRef = await resolveVersionRef(room, data.roomVersionId);
      await assertNotOwned(actor.userId, versionRef.id);

      const amountCents = room.licensePriceCents;
      if (amountCents === 0) {
        const version = await store.findVersion(versionRef.id);
        if (!version) {
          throw new RoomLicenseError(
            "ROOM_VERSION_UNAVAILABLE",
            "La sala no tiene esa versión publicada",
          );
        }
        return { status: "succeeded", ...(await forkNow(room, version, actor.userId, 0)) };
      }
      if (!deps.payments) {
        throw new RoomLicenseError(
          "PAYMENT_GATEWAY_UNAVAILABLE",
          "El pago de licencias todavía no está disponible",
        );
      }
      if (!urls) throw new Error("startLicenseCheckout: faltan las urls de retorno del checkout");
      // Primero el checkout (con el id de la compra ya fijado en su metadata) y
      // luego la compra con su referencia: el CHECK de `purchase` no admite una
      // compra con importe y sin referencia de pago. Si la inserción fallara,
      // el checkout queda huérfano y el webhook no encontraría compra que liquidar.
      const purchaseId = newId();
      const checkout = await deps.payments.createLicenseCheckout({
        purchaseId,
        buyerId: actor.userId,
        roomId: room.id,
        roomVersionId: versionRef.id,
        title: room.title,
        amountCents,
        currency: room.currency,
        successUrl: urls.successUrl,
        cancelUrl: urls.cancelUrl,
      });
      const purchase = await store.insertPendingPurchase({
        id: purchaseId,
        userId: actor.userId,
        roomVersionId: versionRef.id,
        amountCents,
        currency: room.currency,
        ...splitPlatformFee(amountCents),
        paymentRef: checkout.checkoutRef,
      });
      return { status: "pending", purchase, checkoutUrl: checkout.url };
    },

    /**
     * Pago de licencia confirmado: crea el fork y liquida la compra. Interna,
     * sin actor: la invocará el webhook de Stripe tras verificar la firma.
     * Idempotente: una segunda confirmación devuelve el mismo fork.
     *
     * La `Transfer` del reparto (70 %) al creador de la sala de origen YA NO
     * se intenta aquí (B-9, auditoría 2026-09-24): si la cuenta Connect del
     * creador no había completado el onboarding, un `createTransfer` que
     * lanzaba dejaba este método reventando dentro del webhook de Stripe, que
     * lo reintenta durante días — sin que `confirmLicensePayment` (ya
     * `succeeded`) volviera a intentarse. `@escaperoom/worker` la resuelve por
     * su cuenta con reintentos (`creator-payouts.ts`, mismo patrón que el
     * outbox de confirmación de compra), fuera del camino crítico del webhook.
     */
    async confirmLicensePayment(
      purchaseId: string,
      payment: { paymentRef: string },
    ): Promise<ForkResult> {
      const purchase = UUID_RE.test(purchaseId) ? await store.findPurchase(purchaseId) : null;
      if (!purchase) throw new RoomLicenseError("NOT_FOUND", "Compra no encontrada");
      const existing = async (): Promise<ForkResult | null> => {
        const current = await store.findPurchase(purchase.id);
        if (current?.status !== "succeeded" || !current.resultingRoomId) return null;
        const room = await store.findForkRoom(current.resultingRoomId);
        return room ? { room, purchase: current } : null;
      };

      let result: ForkResult | null = null;
      if (purchase.status === "succeeded") {
        result = await existing();
      } else if (purchase.status === "pending") {
        if (!payment.paymentRef.trim()) {
          throw new RoomLicenseError("VALIDATION_ERROR", "Falta la referencia del pago");
        }
        const version = await store.findVersion(purchase.roomVersionId);
        if (!version) {
          throw new RoomLicenseError("ROOM_VERSION_UNAVAILABLE", "La versión comprada ya no existe");
        }
        // El título se toma de la sala si sigue viva; si no, del paquete congelado.
        const origin = await store.findRoom(version.roomId);
        result = await store.createFork({
          ...forkRoom(
            {
              id: version.roomId,
              title: origin?.title ?? version.package.meta.title,
              currency: purchase.currency,
            },
            version,
            purchase.userId,
          ),
          settlement: { kind: "settle", purchaseId: purchase.id, paymentRef: payment.paymentRef },
        });
        // Otra confirmación concurrente ganó: se devuelve su fork.
        result ??= await existing();
      }
      if (!result) {
        throw new RoomLicenseError("PURCHASE_NOT_PENDING", "La compra no está pendiente de pago");
      }
      return result;
    },

    /** `payment_intent.payment_failed` (`purchaseType: 'room_license'`): `pending → failed`. Interna, invocada por el webhook. */
    async markCheckoutFailed(purchaseId: string): Promise<LicensePurchaseRow | null> {
      return store.markFailed(purchaseId);
    },

    /**
     * `charge.refunded`: `succeeded → refunded` SOLO si el reembolso es total
     * (B-5); uno parcial se registra (log) pero no revoca el fork. Si ya se
     * había transferido el reparto al creador de origen, se revierte
     * proporcionalmente al importe reembolsado. Interna, invocada por el webhook.
     */
    async markRefunded(input: {
      paymentIntentId: string;
      amountRefundedCents: number;
      chargeAmountCents: number;
    }): Promise<LicensePurchaseRow | null> {
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
      if (!isFull) return purchase;
      return store.markRefundedByPaymentRef(input.paymentIntentId);
    },

    /**
     * `POST /api/rooms/:roomId/gift-copy` — `{ recipientEmail, roomVersionId? }`.
     * Solo el autor. Fork inmediato a precio 0 en la cuenta del receptor. No
     * exige `licensable`: regalar es una decisión expresa del autor.
     */
    async giftCopy(actor: Actor, roomId: string, input: unknown): Promise<ForkResult> {
      requireUser(actor, RoomLicenseError);
      const room = await findRoom(roomId);
      if (room.authorId !== actor.userId) {
        throw new RoomLicenseError("FORBIDDEN", "Solo el autor puede regalar copias de esta sala");
      }
      const data = parseOrThrow(GiftCopyInput, input);
      if (room.status === "removed") {
        throw new RoomLicenseError(
          "LICENSE_NOT_AVAILABLE",
          "La sala fue retirada por moderación; no se puede copiar",
        );
      }
      const recipientId = await store.findUserIdByEmail(data.recipientEmail);
      if (!recipientId) {
        throw new RoomLicenseError("RECIPIENT_NOT_FOUND", "No hay ningún creador con ese email");
      }
      if (recipientId === actor.userId) {
        throw new RoomLicenseError("INVALID_RECIPIENT", "No puede regalarse una copia a sí mismo");
      }
      const version = await resolveVersion(room, data.roomVersionId);
      await assertNotOwned(recipientId, version.id);
      return forkNow(room, version, recipientId, 0);
    },
  };
}

export type RoomLicenseService = ReturnType<typeof createRoomLicenseService>;

// ── Implementación en memoria (tests y superficies sin base de datos) ──────

/**
 * Store en memoria con la semántica del de Prisma. Las salas del fork y su
 * primer update se escriben en `drafts` (el mismo store del servicio de draft),
 * de modo que el fork se puede abrir y editar con `RoomDraftService`. Los
 * paquetes se guardan y devuelven como copias: lo publicado no se muta.
 */
type InMemoryLicenseRoom = LicenseRoomRef & {
  forkedFromRoomId?: string;
  forkedFromVersionId?: string;
  createdAt?: Date;
};

export function createInMemoryRoomLicenseStore(opts: {
  users?: Array<{ id: string; email: string }>;
  rooms?: LicenseRoomRef[];
  versions?: LicenseVersionRef[];
  drafts: {
    addRoom(room: { id: string; authorId: string }): void;
    insertUpdate(roomId: string, data: Uint8Array, authorId: string | null): Promise<unknown>;
  };
}): RoomLicenseStore & {
  rooms: Map<string, InMemoryLicenseRoom>;
  purchases: LicensePurchaseRow[];
  addVersion(version: LicenseVersionRef): void;
} {
  const users = new Map((opts.users ?? []).map((u) => [u.email.toLowerCase(), u.id]));
  const rooms = new Map<string, InMemoryLicenseRoom>(
    (opts.rooms ?? []).map((r) => [r.id, { ...r }]),
  );
  const versions: LicenseVersionRef[] = (opts.versions ?? []).map((v) => structuredClone(v));
  const purchases: LicensePurchaseRow[] = [];
  let clock = Date.UTC(2026, 0, 1);
  const copy = <T>(v: T): T => structuredClone(v);

  return {
    rooms,
    purchases,
    addVersion(version) {
      versions.push(structuredClone(version));
    },
    async findUserIdByEmail(email) {
      return users.get(email.toLowerCase()) ?? null;
    },
    async findRoom(roomId) {
      const room = rooms.get(roomId);
      if (!room) return null;
      return {
        id: room.id,
        authorId: room.authorId,
        title: room.title,
        status: room.status,
        licensable: room.licensable,
        licensePriceCents: room.licensePriceCents,
        currency: room.currency,
      };
    },
    async findLatestVersion(roomId) {
      const found = versions.filter((v) => v.roomId === roomId).at(-1);
      return found ? copy(found) : null;
    },
    async findVersion(versionId) {
      const found = versions.find((v) => v.id === versionId);
      return found ? copy(found) : null;
    },
    async findLatestVersionRef(roomId) {
      const found = versions.filter((v) => v.roomId === roomId).at(-1);
      return found ? { id: found.id, roomId: found.roomId, semver: found.semver } : null;
    },
    async findVersionRef(versionId) {
      const found = versions.find((v) => v.id === versionId);
      return found ? { id: found.id, roomId: found.roomId, semver: found.semver } : null;
    },
    async findPurchase(id) {
      const found = purchases.find((p) => p.id === id);
      return found ? copy(found) : null;
    },
    async findForkRoom(roomId) {
      const room = rooms.get(roomId);
      if (!room?.forkedFromRoomId || !room.forkedFromVersionId || !room.createdAt) return null;
      return {
        id: room.id,
        authorId: room.authorId,
        title: room.title,
        currency: room.currency,
        status: room.status,
        forkedFromRoomId: room.forkedFromRoomId,
        forkedFromVersionId: room.forkedFromVersionId,
        createdAt: room.createdAt,
      };
    },
    async findOwnedLicense(userId, roomVersionId) {
      const found = purchases.find(
        (p) => p.userId === userId && p.roomVersionId === roomVersionId && p.status === "succeeded",
      );
      return found ? copy(found) : null;
    },
    async markFailed(purchaseId) {
      const row = purchases.find((p) => p.id === purchaseId);
      if (!row || row.status !== "pending") return null;
      row.status = "failed";
      return copy(row);
    },
    async findPurchaseByPaymentRef(paymentRef) {
      const found = purchases.find((p) => p.paymentRef === paymentRef);
      return found ? copy(found) : null;
    },
    async markRefundedByPaymentRef(paymentRef) {
      const row = purchases.find((p) => p.paymentRef === paymentRef);
      if (!row || row.status !== "succeeded") return null;
      row.status = "refunded";
      return copy(row);
    },
    async insertPendingPurchase(purchase) {
      if (purchase.amountCents > 0 && !purchase.paymentRef) {
        throw new Error("CHECK chkPurchasePaidNeedsStripe violado");
      }
      const row: LicensePurchaseRow = {
        ...purchase,
        resultingRoomId: null,
        transferRef: null,
        status: "pending",
        createdAt: new Date((clock += 1000)),
      };
      purchases.push(row);
      return copy(row);
    },
    async createFork({ room, initialUpdate, settlement }) {
      let purchase: LicensePurchaseRow;
      if (settlement.kind === "settle") {
        const row = purchases.find((p) => p.id === settlement.purchaseId);
        if (!row || row.status !== "pending") return null;
        row.status = "succeeded";
        row.paymentRef = settlement.paymentRef;
        row.resultingRoomId = room.id;
        purchase = row;
      } else {
        purchase = {
          ...settlement.purchase,
          id: crypto.randomUUID(),
          resultingRoomId: room.id,
          paymentRef: null,
          transferRef: null,
          status: "succeeded",
          createdAt: new Date((clock += 1000)),
        };
        purchases.push(purchase);
      }
      const createdAt = new Date((clock += 1000));
      rooms.set(room.id, {
        id: room.id,
        authorId: room.authorId,
        title: room.title,
        status: "draft",
        licensable: false,
        licensePriceCents: null,
        currency: room.currency,
        forkedFromRoomId: room.forkedFromRoomId,
        forkedFromVersionId: room.forkedFromVersionId,
        createdAt,
      });
      opts.drafts.addRoom({ id: room.id, authorId: room.authorId });
      await opts.drafts.insertUpdate(room.id, initialUpdate, room.authorId);
      return {
        room: { ...room, status: "draft", createdAt },
        purchase: copy(purchase),
      };
    },
  };
}
