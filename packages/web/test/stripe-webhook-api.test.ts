import {
  createFakePaymentGateway,
  createInMemoryPurchaseStore,
  createInMemoryWebhookEventDedupeStore,
  createPurchaseService,
  type Actor,
  type PaymentGateway,
} from "@escaperoom/shared/services";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { createStripeWebhookHandlers } from "../src/server/rest/stripe-webhook";

const buyer: Actor = { userId: "compradora", organizationId: null, role: "member" };
const ROOM = "20000000-0000-4000-8000-000000000001";
const VERSION = "10000000-0000-4000-8000-000000000001";

/** Construye eventos de Stripe mínimos, tal y como los necesita `dispatch`. */
function checkoutCompleted(id: string, purchaseId: string, paymentIntentId: string): Stripe.Event {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        metadata: { purchaseType: "room", purchaseId },
        payment_intent: paymentIntentId,
      },
    },
  } as unknown as Stripe.Event;
}

function paymentFailed(id: string, purchaseId: string): Stripe.Event {
  return {
    id,
    type: "payment_intent.payment_failed",
    data: { object: { metadata: { purchaseType: "room", purchaseId } } },
  } as unknown as Stripe.Event;
}

function chargeRefunded(id: string, paymentIntentId: string): Stripe.Event {
  return {
    id,
    type: "charge.refunded",
    data: { object: { payment_intent: paymentIntentId } },
  } as unknown as Stripe.Event;
}

function setup(payments: PaymentGateway = createFakePaymentGateway()) {
  const store = createInMemoryPurchaseStore({
    rooms: [
      {
        id: ROOM,
        authorId: "autora",
        title: "Sala",
        status: "published",
        saleIndividual: true,
        priceCents: 299,
        currency: "EUR",
      },
    ],
    versions: [{ id: VERSION, roomId: ROOM }],
  });
  const purchases = createPurchaseService({ store, payments });
  const dedupe = createInMemoryWebhookEventDedupeStore();
  let nextEvent: Stripe.Event | null = null;
  const handlers = createStripeWebhookHandlers({
    purchases,
    dedupe,
    verify: () => {
      if (!nextEvent) throw new Error("firma no válida (test sin evento preparado)");
      return nextEvent;
    },
  });
  const post = (event: Stripe.Event | null) => {
    nextEvent = event;
    return handlers.postWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=fake" },
        body: "{}",
      }),
    );
  };
  return { store, purchases, dedupe, post };
}

describe("POST /api/stripe/webhook", () => {
  it("400 sin cabecera Stripe-Signature", async () => {
    const noSig = await createStripeWebhookHandlers({
      purchases: setup().purchases,
      dedupe: createInMemoryWebhookEventDedupeStore(),
      verify: () => {
        throw new Error("no debería llamarse");
      },
    }).postWebhook(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}" }));
    expect(noSig.status).toBe(400);
  });

  it("400 si la firma no es válida", async () => {
    const { post } = setup();
    const res = await post(null);
    expect(res.status).toBe(400);
  });

  it("checkout.session.completed liquida la compra y transfiere el reparto", async () => {
    const { store, post } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000001",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_1",
    });
    const res = await post(checkoutCompleted("evt_1", purchase.id, "pi_1"));
    expect(res.status).toBe(200);
    const settled = await store.findPurchase(purchase.id);
    expect(settled?.status).toBe("succeeded");
    expect(settled?.platformFeeCents).toBe(90);
  });

  it("es idempotente: un evt.id repetido no reprocesa", async () => {
    const { store, post } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000002",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_2",
    });
    const event = checkoutCompleted("evt_2", purchase.id, "pi_2");
    const first = await post(event);
    const second = await post(event);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { duplicate?: boolean };
    expect(secondBody.duplicate).toBe(true);
  });

  it("payment_intent.payment_failed marca la compra como failed", async () => {
    const { store, post } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000003",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_3",
    });
    const res = await post(paymentFailed("evt_3", purchase.id));
    expect(res.status).toBe(200);
    expect((await store.findPurchase(purchase.id))?.status).toBe("failed");
  });

  it("charge.refunded marca la compra como refunded", async () => {
    const { store, post } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000004",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_4",
    });
    await post(checkoutCompleted("evt_4a", purchase.id, "pi_4"));
    const res = await post(chargeRefunded("evt_4b", "pi_4"));
    expect(res.status).toBe(200);
    expect((await store.findPurchase(purchase.id))?.status).toBe("refunded");
  });
});
