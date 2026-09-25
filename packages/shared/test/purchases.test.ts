import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  createFakePaymentGateway,
  createInMemoryPurchaseStore,
  createPurchaseService,
  PurchaseError,
  splitRoomAmount,
  type Actor,
  type PaymentGateway,
  type PurchaseRoomRef,
} from "../src/services";

const ROOM = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOM = "11111111-1111-4111-8111-111111111112";
const VERSION = "22222222-2222-4222-8222-222222222221";
const OTHER_VERSION = "22222222-2222-4222-8222-222222222222";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const buyer: Actor = { userId: "compradora", organizationId: null, role: "member" };
const admin: Actor = { userId: "admin", organizationId: null, role: "member" };

function setup(room: Partial<PurchaseRoomRef> = {}, payments: PaymentGateway | null = createFakePaymentGateway()) {
  const store = createInMemoryPurchaseStore({
    adminIds: [admin.userId],
    rooms: [
      {
        id: ROOM,
        authorId: author.userId,
        title: "La Maldición del Rey Aldric",
        status: "published",
        saleIndividual: true,
        priceCents: 299,
        currency: "EUR",
        ...room,
      },
      {
        id: OTHER_ROOM,
        authorId: author.userId,
        title: "Otra sala",
        status: "draft",
        saleIndividual: true,
        priceCents: 299,
        currency: "EUR",
      },
    ],
    versions: [
      { id: VERSION, roomId: ROOM },
      { id: OTHER_VERSION, roomId: OTHER_ROOM },
    ],
  });
  const service = createPurchaseService({ store, payments });
  return { store, service, payments };
}

/** B-21: el servicio construye la URL una vez conoce `purchaseId`/`roomId`. */
const buildUrls = ({ purchaseId, roomId }: { purchaseId: string; roomId: string }) => ({
  successUrl: `https://app.test/success?purchaseId=${purchaseId}&roomId=${roomId}`,
  cancelUrl: `https://app.test/cancel?roomId=${roomId}`,
});

describe("purchases", () => {
  it("splitRoomAmount reparte 70/30 redondeando la comisión", () => {
    expect(splitRoomAmount(299)).toEqual({ platformFeeCents: 90, creatorShareCents: 209 });
    expect(splitRoomAmount(0)).toEqual({ platformFeeCents: 0, creatorShareCents: 0 });
  });

  it("authorize exige sesión", () => {
    const { service } = setup();
    expect(() => service.authorize(ANONYMOUS_ACTOR)).toThrow(PurchaseError);
  });

  it("startRoomCheckout crea una compra pendiente y abre el checkout", async () => {
    const { service, store, payments } = setup();
    const { purchase, checkoutUrl } = await service.startRoomCheckout(
      buyer,
      { roomVersionId: VERSION },
      buildUrls,
    );
    expect(purchase.status).toBe("pending");
    expect(purchase.amountCents).toBe(299);
    // El reparto se resuelve en el webhook, no en la creación (specs/13 §5).
    expect(purchase.platformFeeCents).toBe(0);
    expect(purchase.creatorShareCents).toBeNull();
    expect(checkoutUrl).toContain("fake_cs_room_1");
    const fake = payments as ReturnType<typeof createFakePaymentGateway>;
    expect(fake.roomCalls).toHaveLength(1);
    // B-21: la URL de éxito lleva `purchaseId` y `roomId` (para que la
    // confirmación pueda mostrar el estado real y enlazar la sala).
    expect(fake.roomCalls[0]?.successUrl).toContain(`purchaseId=${purchase.id}`);
    expect(fake.roomCalls[0]?.successUrl).toContain(`roomId=${ROOM}`);
    expect(store.rows).toHaveLength(1);
  });

  it("startRoomCheckout responde PAYMENT_GATEWAY_UNAVAILABLE sin pasarela", async () => {
    const { service } = setup({}, null);
    await expect(
      service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls),
    ).rejects.toMatchObject({ code: "PAYMENT_GATEWAY_UNAVAILABLE" });
  });

  it("startRoomCheckout responde SALE_INDIVIDUAL_DISABLED si la sala no está a la venta individual", async () => {
    const { service } = setup({ saleIndividual: false });
    await expect(
      service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls),
    ).rejects.toMatchObject({ code: "SALE_INDIVIDUAL_DISABLED" });
  });

  it("startRoomCheckout responde ROOM_VERSION_UNAVAILABLE si la sala está en borrador", async () => {
    const { service } = setup();
    await expect(
      service.startRoomCheckout(buyer, { roomVersionId: OTHER_VERSION }, buildUrls),
    ).rejects.toMatchObject({ code: "ROOM_VERSION_UNAVAILABLE" });
  });

  it("startRoomCheckout responde PURCHASE_OWN_ROOM si el autor intenta comprar su propia sala (B-16)", async () => {
    const { service } = setup();
    await expect(
      service.startRoomCheckout(author, { roomVersionId: VERSION }, buildUrls),
    ).rejects.toMatchObject({ code: "PURCHASE_OWN_ROOM" });
  });

  it("startRoomCheckout responde ALREADY_OWNED si ya compró la sala", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls);
    await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    await expect(
      service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls),
    ).rejects.toMatchObject({ code: "ALREADY_OWNED" });
  });

  it("getPurchase la ve el comprador y un admin, no un tercero", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls);
    await expect(service.getPurchase(buyer, purchase.id)).resolves.toMatchObject({ id: purchase.id });
    await expect(service.getPurchase(admin, purchase.id)).resolves.toMatchObject({ id: purchase.id });
    await expect(service.getPurchase(author, purchase.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("confirmRoomCheckout liquida la compra y calcula el reparto, SIN transferir (B-9: la Transfer es del worker)", async () => {
    const { service, payments } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls);
    const settled = await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    expect(settled.status).toBe("succeeded");
    expect(settled.platformFeeCents).toBe(90);
    expect(settled.creatorShareCents).toBe(209);
    expect(settled.transferRef).toBeNull();
    const fake = payments as ReturnType<typeof createFakePaymentGateway>;
    expect(fake.transferCalls).toHaveLength(0);
  });

  it("confirmRoomCheckout es idempotente: una segunda confirmación devuelve la misma compra", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls);
    const first = await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    const second = await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    expect(second).toEqual(first);
  });

  it("markCheckoutFailed marca failed solo si estaba pending", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls);
    const failed = await service.markCheckoutFailed(purchase.id);
    expect(failed?.status).toBe("failed");
    expect(await service.markCheckoutFailed(purchase.id)).toBeNull();
  });

  it("markRefunded marca refunded solo si el reembolso es total, buscando por el PaymentIntent", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls);
    const refund = { paymentIntentId: "pi_1", amountRefundedCents: 299, chargeAmountCents: 299 };
    expect(await service.markRefunded(refund)).toBeNull();
    await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    const refunded = await service.markRefunded(refund);
    expect(refunded?.status).toBe("refunded");
  });

  it("markRefunded NO marca refunded (queda succeeded) si el reembolso es parcial", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls);
    await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    const result = await service.markRefunded({
      paymentIntentId: "pi_1",
      amountRefundedCents: 100,
      chargeAmountCents: 299,
    });
    expect(result?.status).toBe("succeeded");
  });

  it("markRefunded revierte proporcionalmente la Transfer ya hecha (B-5)", async () => {
    const { service, store, payments } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, buildUrls);
    await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    // Simula que el worker de payouts (B-9) ya transfirió el reparto.
    const row = store.rows.find((p) => p.id === purchase.id);
    if (!row) throw new Error("compra no encontrada");
    row.transferRef = "tr_1";

    await service.markRefunded({ paymentIntentId: "pi_1", amountRefundedCents: 150, chargeAmountCents: 299 });
    const fake = payments as ReturnType<typeof createFakePaymentGateway>;
    expect(fake.reversalCalls).toEqual([
      { transferId: "tr_1", amountCents: Math.round(209 * (150 / 299)) },
    ]);
  });
});
