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

function setup(
  room: Partial<PurchaseRoomRef> = {},
  payments: PaymentGateway | null = createFakePaymentGateway(),
  connectedAccounts: Record<string, string> = {},
) {
  const store = createInMemoryPurchaseStore({
    adminIds: [admin.userId],
    connectedAccounts,
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

const urls = { successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" };

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
      urls,
    );
    expect(purchase.status).toBe("pending");
    expect(purchase.amountCents).toBe(299);
    // El reparto se resuelve en el webhook, no en la creación (specs/13 §5).
    expect(purchase.platformFeeCents).toBe(0);
    expect(purchase.creatorShareCents).toBeNull();
    expect(checkoutUrl).toContain("fake_cs_room_1");
    expect((payments as ReturnType<typeof createFakePaymentGateway>).roomCalls).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });

  it("startRoomCheckout responde PAYMENT_GATEWAY_UNAVAILABLE sin pasarela", async () => {
    const { service } = setup({}, null);
    await expect(service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls)).rejects.toMatchObject({
      code: "PAYMENT_GATEWAY_UNAVAILABLE",
    });
  });

  it("startRoomCheckout responde SALE_INDIVIDUAL_DISABLED si la sala no está a la venta individual", async () => {
    const { service } = setup({ saleIndividual: false });
    await expect(service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls)).rejects.toMatchObject({
      code: "SALE_INDIVIDUAL_DISABLED",
    });
  });

  it("startRoomCheckout responde ROOM_VERSION_UNAVAILABLE si la sala está en borrador", async () => {
    const { service } = setup();
    await expect(
      service.startRoomCheckout(buyer, { roomVersionId: OTHER_VERSION }, urls),
    ).rejects.toMatchObject({ code: "ROOM_VERSION_UNAVAILABLE" });
  });

  it("startRoomCheckout responde ALREADY_OWNED si ya compró la sala", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls);
    await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    await expect(service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls)).rejects.toMatchObject({
      code: "ALREADY_OWNED",
    });
  });

  it("getPurchase la ve el comprador y un admin, no un tercero", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls);
    await expect(service.getPurchase(buyer, purchase.id)).resolves.toMatchObject({ id: purchase.id });
    await expect(service.getPurchase(admin, purchase.id)).resolves.toMatchObject({ id: purchase.id });
    await expect(service.getPurchase(author, purchase.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("confirmRoomCheckout liquida la compra, calcula el reparto y transfiere si hay cuenta Connect", async () => {
    const { service, payments } = setup({}, undefined, { [author.userId]: "acct_creator" });
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls);
    const settled = await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    expect(settled.status).toBe("succeeded");
    expect(settled.platformFeeCents).toBe(90);
    expect(settled.creatorShareCents).toBe(209);
    expect(settled.transferRef).toBe("fake_tr_1");
    const fake = payments as ReturnType<typeof createFakePaymentGateway>;
    expect(fake.transferCalls).toEqual([
      {
        purchaseId: purchase.id,
        amountCents: 209,
        currency: "EUR",
        destinationAccountId: "acct_creator",
        paymentIntentId: "pi_1",
      },
    ]);
  });

  it("confirmRoomCheckout es idempotente: no repite la transferencia", async () => {
    const { service } = setup({}, undefined, { [author.userId]: "acct_creator" });
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls);
    const first = await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    const second = await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    expect(second.transferRef).toBe(first.transferRef);
  });

  it("confirmRoomCheckout liquida sin transferir si el creador no tiene cuenta Connect", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls);
    const settled = await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    expect(settled.status).toBe("succeeded");
    expect(settled.transferRef).toBeNull();
  });

  it("markCheckoutFailed marca failed solo si estaba pending", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls);
    const failed = await service.markCheckoutFailed(purchase.id);
    expect(failed?.status).toBe("failed");
    expect(await service.markCheckoutFailed(purchase.id)).toBeNull();
  });

  it("markRefunded marca refunded solo si estaba succeeded, buscando por el PaymentIntent", async () => {
    const { service } = setup();
    const { purchase } = await service.startRoomCheckout(buyer, { roomVersionId: VERSION }, urls);
    expect(await service.markRefunded("pi_1")).toBeNull();
    await service.confirmRoomCheckout({ purchaseId: purchase.id, paymentIntentId: "pi_1" });
    const refunded = await service.markRefunded("pi_1");
    expect(refunded?.status).toBe("refunded");
  });
});
