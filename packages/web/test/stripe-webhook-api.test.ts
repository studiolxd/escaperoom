import {
  createEventService,
  createFakePaymentGateway,
  createInMemoryEventStore,
  createInMemoryPricingTierStore,
  createInMemoryPurchaseStore,
  createInMemoryRoomLicenseStore,
  createInMemoryWebhookEventDedupeStore,
  createPricingTierService,
  createPurchaseService,
  createRoomLicenseService,
  type Actor,
  type PaymentGateway,
} from "@escaperoom/shared/services";
import * as Y from "yjs";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { createStripeWebhookHandlers } from "../src/server/rest/stripe-webhook";

const buyer: Actor = { userId: "compradora", organizationId: null, role: "member" };
const ROOM = "20000000-0000-4000-8000-000000000001";
const VERSION = "10000000-0000-4000-8000-000000000001";
const LICENSE_ROOM = "20000000-0000-4000-8000-000000000002";
const LICENSE_VERSION = "10000000-0000-4000-8000-000000000002";
const EVENT_ROOM_VERSION = "10000000-0000-4000-8000-000000000003";

/** Construye eventos de Stripe mínimos, tal y como los necesita `dispatch`. */
function checkoutCompleted(
  id: string,
  metadata: Record<string, string>,
  paymentIntentId: string,
): Stripe.Event {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        metadata,
        payment_intent: paymentIntentId,
      },
    },
  } as unknown as Stripe.Event;
}

function paymentFailed(id: string, metadata: Record<string, string>): Stripe.Event {
  return {
    id,
    type: "payment_intent.payment_failed",
    data: { object: { metadata } },
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

  const drafts = { addRoom: () => {}, insertUpdate: async () => undefined };
  const licenseStore = createInMemoryRoomLicenseStore({
    rooms: [
      {
        id: LICENSE_ROOM,
        authorId: "autora-origen",
        title: "Sala licenciable",
        status: "published",
        licensable: true,
        licensePriceCents: 500,
        currency: "EUR",
      },
    ],
    versions: [
      {
        id: LICENSE_VERSION,
        roomId: LICENSE_ROOM,
        semver: "1.0.0",
        package: { meta: { id: LICENSE_ROOM, authorId: "autora-origen", title: "Sala licenciable" } } as never,
      },
    ],
    connectedAccounts: { "autora-origen": "acct_origen" },
    drafts,
  });
  const roomLicenses = createRoomLicenseService({
    store: licenseStore,
    buildDoc: () => new Y.Doc(),
    payments,
  });

  const eventStore = createInMemoryEventStore({
    roomVersions: [
      {
        roomVersionId: EVENT_ROOM_VERSION,
        roomId: "20000000-0000-4000-8000-000000000003",
        authorId: "autora-evento",
        roomStatus: "published",
        saleEvents: true,
      },
    ],
  });
  const pricingTiers = createPricingTierService({
    store: createInMemoryPricingTierStore({
      tiers: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          minPlayers: 1,
          maxPlayers: null,
          priceCentsPerPlayer: 100,
          currency: "EUR",
          activeFrom: new Date("2026-01-01T00:00:00Z"),
          activeUntil: null,
          createdBy: "seed-admin",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    }),
  });
  const events = createEventService({ store: eventStore, pricing: pricingTiers, payments });

  const dedupe = createInMemoryWebhookEventDedupeStore();
  let nextEvent: Stripe.Event | null = null;
  const handlers = createStripeWebhookHandlers({
    purchases,
    roomLicenses,
    events,
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
  return { store, purchases, licenseStore, roomLicenses, eventStore, events, dedupe, post };
}

describe("POST /api/stripe/webhook", () => {
  it("400 sin cabecera Stripe-Signature", async () => {
    const s = setup();
    const noSig = await createStripeWebhookHandlers({
      purchases: s.purchases,
      roomLicenses: s.roomLicenses,
      events: s.events,
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

  it("checkout.session.completed (room) liquida la compra y transfiere el reparto", async () => {
    const { store, post } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000001",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_1",
    });
    const res = await post(checkoutCompleted("evt_1", { purchaseType: "room", purchaseId: purchase.id }, "pi_1"));
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
    const event = checkoutCompleted("evt_2", { purchaseType: "room", purchaseId: purchase.id }, "pi_2");
    const first = await post(event);
    const second = await post(event);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { duplicate?: boolean };
    expect(secondBody.duplicate).toBe(true);
  });

  it("payment_intent.payment_failed (room) marca la compra como failed", async () => {
    const { store, post } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000003",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_3",
    });
    const res = await post(paymentFailed("evt_3", { purchaseType: "room", purchaseId: purchase.id }));
    expect(res.status).toBe(200);
    expect((await store.findPurchase(purchase.id))?.status).toBe("failed");
  });

  it("charge.refunded (room) marca la compra como refunded", async () => {
    const { store, post } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000004",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_4",
    });
    await post(checkoutCompleted("evt_4a", { purchaseType: "room", purchaseId: purchase.id }, "pi_4"));
    const res = await post(chargeRefunded("evt_4b", "pi_4"));
    expect(res.status).toBe(200);
    expect((await store.findPurchase(purchase.id))?.status).toBe("refunded");
  });

  it("checkout.session.completed (room_license) crea el fork y transfiere el 70% al creador de origen", async () => {
    const { licenseStore, post } = setup();
    const purchase = await licenseStore.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000005",
      userId: buyer.userId,
      roomVersionId: LICENSE_VERSION,
      amountCents: 500,
      currency: "EUR",
      platformFeeCents: 150,
      creatorShareCents: 350,
      paymentRef: "cs_license_1",
    });
    const res = await post(
      checkoutCompleted("evt_5", { purchaseType: "room_license", purchaseId: purchase.id }, "pi_5"),
    );
    expect(res.status).toBe(200);
    const settled = await licenseStore.findPurchase(purchase.id);
    expect(settled?.status).toBe("succeeded");
    expect(settled?.resultingRoomId).toBeTruthy();
    expect(settled?.transferRef).toBe("fake_tr_1");
  });

  it("payment_intent.payment_failed (room_license) marca la compra como failed", async () => {
    const { licenseStore, post } = setup();
    const purchase = await licenseStore.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000006",
      userId: buyer.userId,
      roomVersionId: LICENSE_VERSION,
      amountCents: 500,
      currency: "EUR",
      platformFeeCents: 150,
      creatorShareCents: 350,
      paymentRef: "cs_license_2",
    });
    const res = await post(
      paymentFailed("evt_6", { purchaseType: "room_license", purchaseId: purchase.id }),
    );
    expect(res.status).toBe(200);
    expect((await licenseStore.findPurchase(purchase.id))?.status).toBe("failed");
  });

  it("checkout.session.completed (event_credits) marca el evento como pagado y lo activa", async () => {
    const { eventStore, events, post } = setup();
    const event = await events.createEvent(
      { userId: "otro-organizador", organizationId: null, role: "member" },
      {
        roomVersionId: EVENT_ROOM_VERSION,
        title: "Jornada escolar",
        maxSimultaneousSessions: 1,
        groupingMode: "free",
        requireConfirmation: false,
        expiryRules: [],
        playersPlanned: 10,
      },
    );
    expect(event.status).toBe("draft");
    const res = await post(
      checkoutCompleted("evt_7", { purchaseType: "event_credits", eventId: event.id }, "pi_7"),
    );
    expect(res.status).toBe(200);
    const settled = await eventStore.findEvent(event.id);
    expect(settled?.status).toBe("active");
    expect(settled?.config.payment.status).toBe("paid");
  });

  it("payment_intent.payment_failed (event_credits) libera el checkout para reintentar", async () => {
    const { eventStore, events, post } = setup();
    const event = await events.createEvent(
      { userId: "otro-organizador", organizationId: null, role: "member" },
      {
        roomVersionId: EVENT_ROOM_VERSION,
        title: "Jornada escolar 2",
        maxSimultaneousSessions: 1,
        groupingMode: "free",
        requireConfirmation: false,
        expiryRules: [],
        playersPlanned: 10,
      },
    );
    await events.startCheckout({ userId: "otro-organizador", organizationId: null, role: "member" }, event.id);
    const res = await post(
      paymentFailed("evt_8", { purchaseType: "event_credits", eventId: event.id }),
    );
    expect(res.status).toBe(200);
    const settled = await eventStore.findEvent(event.id);
    expect(settled?.config.payment.checkoutRef).toBeNull();
  });
});
