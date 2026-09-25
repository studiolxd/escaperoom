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
import type { PurchaseConfirmationEmailJob } from "@escaperoom/shared/mail";
import * as Y from "yjs";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@escaperoom/kit/logger", () => ({ logger: loggerMock }));

import { createStripeWebhookHandlers } from "../src/server/rest/stripe-webhook";

const buyer: Actor = { userId: "compradora", organizationId: null, role: "member" };
const organizer: Actor = { userId: "otro-organizador", organizationId: null, role: "member" };
const ROOM = "20000000-0000-4000-8000-000000000001";
const VERSION = "10000000-0000-4000-8000-000000000001";
const LICENSE_ROOM = "20000000-0000-4000-8000-000000000002";
const LICENSE_VERSION = "10000000-0000-4000-8000-000000000002";
const EVENT_ROOM_VERSION = "10000000-0000-4000-8000-000000000003";
const CHECKOUT_URLS = { successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" };

/** Construye eventos de Stripe mínimos, tal y como los necesita `dispatch`. */
function checkoutCompleted(
  id: string,
  metadata: Record<string, string>,
  paymentIntentId: string,
  opts: { sessionId?: string; amountTotal?: number; paymentStatus?: string } = {},
): Stripe.Event {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: opts.sessionId ?? "cs_test",
        metadata,
        payment_intent: paymentIntentId,
        payment_status: opts.paymentStatus ?? "paid",
        amount_total: opts.amountTotal ?? 0,
      },
    },
  } as unknown as Stripe.Event;
}

function checkoutExpired(id: string, metadata: Record<string, string>, sessionId: string): Stripe.Event {
  return {
    id,
    type: "checkout.session.expired",
    data: { object: { id: sessionId, metadata } },
  } as unknown as Stripe.Event;
}

function paymentFailed(id: string, metadata: Record<string, string>): Stripe.Event {
  return {
    id,
    type: "payment_intent.payment_failed",
    data: { object: { metadata } },
  } as unknown as Stripe.Event;
}

function chargeRefunded(
  id: string,
  paymentIntentId: string,
  opts: { amount?: number; amountRefunded?: number } = {},
): Stripe.Event {
  return {
    id,
    type: "charge.refunded",
    data: {
      object: {
        payment_intent: paymentIntentId,
        amount: opts.amount ?? 299,
        amount_refunded: opts.amountRefunded ?? opts.amount ?? 299,
      },
    },
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
  const confirmationJobs: PurchaseConfirmationEmailJob[] = [];
  const confirmations = {
    async enqueue(job: PurchaseConfirmationEmailJob) {
      confirmationJobs.push(job);
      return `conf-${confirmationJobs.length}`;
    },
  };
  let nextEvent: Stripe.Event | null = null;
  const handlers = createStripeWebhookHandlers({
    purchases,
    roomLicenses,
    events,
    dedupe,
    confirmations,
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
  return {
    store,
    purchases,
    licenseStore,
    roomLicenses,
    eventStore,
    events,
    dedupe,
    confirmationJobs,
    post,
  };
}

/** Abre un checkout de evento real (B-1/B-8: congela `purchaseId`/importe) y devuelve sus datos. */
async function openEventCheckout(
  events: ReturnType<typeof setup>["events"],
  title = "Jornada escolar",
) {
  const event = await events.createEvent(organizer, {
    roomVersionId: EVENT_ROOM_VERSION,
    title,
    maxSimultaneousSessions: 1,
    groupingMode: "free",
    requireConfirmation: false,
    expiryRules: [],
    playersPlanned: 10,
  });
  const { event: withCheckout } = await events.startCheckout(organizer, event.id, CHECKOUT_URLS);
  return {
    eventId: event.id,
    purchaseId: withCheckout.config.payment.purchaseId!,
    sessionId: withCheckout.config.payment.checkoutRef!,
    amountTotal: withCheckout.pricing.amountDueCents,
  };
}

describe("POST /api/stripe/webhook", () => {
  it("400 sin cabecera Stripe-Signature", async () => {
    const s = setup();
    const noSig = await createStripeWebhookHandlers({
      purchases: s.purchases,
      roomLicenses: s.roomLicenses,
      events: s.events,
      dedupe: createInMemoryWebhookEventDedupeStore(),
      confirmations: { enqueue: async () => null },
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

  it("E-11: si enqueue devuelve null (Redis caído), no lanza y registra el fallo con logger.error", async () => {
    const { store, purchases, roomLicenses, events, dedupe } = setup();
    loggerMock.error.mockClear();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000009",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_9",
    });
    let nextEvent: Stripe.Event | null = null;
    const handlers = createStripeWebhookHandlers({
      purchases,
      roomLicenses,
      events,
      dedupe,
      confirmations: { enqueue: async () => null },
      verify: () => {
        if (!nextEvent) throw new Error("sin evento");
        return nextEvent;
      },
    });
    nextEvent = checkoutCompleted("evt_9", { purchaseType: "room", purchaseId: purchase.id }, "pi_9");
    const res = await handlers.postWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=fake" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    const settled = await store.findPurchase(purchase.id);
    expect(settled?.status).toBe("succeeded"); // la compra se liquida igual: el email es secundario.
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "room", ref: purchase.id }),
      expect.stringContaining("no se pudo encolar"),
    );
  });

  it("checkout.session.completed (room) liquida la compra y encola el email de confirmación, SIN transferir (B-9: la Transfer es del worker)", async () => {
    const { store, post, confirmationJobs } = setup();
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
    expect(settled?.transferRef).toBeNull();
    expect(confirmationJobs).toEqual([{ kind: "room", purchaseId: purchase.id }]);
  });

  it("checkout.session.completed sin payment_status: paid no liquida nada (B-12, p. ej. SEPA pendiente)", async () => {
    const { store, post, confirmationJobs } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000010",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_10",
    });
    const res = await post(
      checkoutCompleted(
        "evt_10",
        { purchaseType: "room", purchaseId: purchase.id },
        "pi_10",
        { paymentStatus: "unpaid" },
      ),
    );
    expect(res.status).toBe(200);
    expect((await store.findPurchase(purchase.id))?.status).toBe("pending");
    expect(confirmationJobs).toEqual([]);
  });

  it("checkout.session.async_payment_succeeded liquida como completed (B-12)", async () => {
    const { store, post } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000011",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_11",
    });
    const event = checkoutCompleted("evt_11", { purchaseType: "room", purchaseId: purchase.id }, "pi_11");
    event.type = "checkout.session.async_payment_succeeded";
    const res = await post(event);
    expect(res.status).toBe(200);
    expect((await store.findPurchase(purchase.id))?.status).toBe("succeeded");
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

  it("charge.refunded (room) marca la compra como refunded si el reembolso es total", async () => {
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
    const res = await post(chargeRefunded("evt_4b", "pi_4", { amount: 299, amountRefunded: 299 }));
    expect(res.status).toBe(200);
    expect((await store.findPurchase(purchase.id))?.status).toBe("refunded");
  });

  it("charge.refunded (room) parcial NO marca refunded (B-5)", async () => {
    const { store, post } = setup();
    const purchase = await store.insertPendingPurchase({
      id: "30000000-0000-4000-8000-000000000012",
      userId: buyer.userId,
      roomVersionId: VERSION,
      amountCents: 299,
      currency: "EUR",
      paymentRef: "cs_test_12",
    });
    await post(checkoutCompleted("evt_12a", { purchaseType: "room", purchaseId: purchase.id }, "pi_12"));
    const res = await post(chargeRefunded("evt_12b", "pi_12", { amount: 299, amountRefunded: 100 }));
    expect(res.status).toBe(200);
    expect((await store.findPurchase(purchase.id))?.status).toBe("succeeded");
  });

  it("checkout.session.completed (room_license) crea el fork y encola el email de confirmación, SIN transferir (B-9)", async () => {
    const { licenseStore, post, confirmationJobs } = setup();
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
    expect(settled?.transferRef).toBeNull();
    expect(confirmationJobs).toEqual([{ kind: "room_license", purchaseId: purchase.id }]);
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

  it("checkout.session.completed (event_credits) marca el pago como pagado, SIN activar (B-2), y encola el email", async () => {
    const { eventStore, events, post, confirmationJobs } = setup();
    const { eventId, purchaseId, sessionId, amountTotal } = await openEventCheckout(events);
    const res = await post(
      checkoutCompleted(
        "evt_7",
        { purchaseType: "event_credits", purchaseId, eventId },
        "pi_7",
        { sessionId, amountTotal },
      ),
    );
    expect(res.status).toBe(200);
    const settled = await eventStore.findEvent(eventId);
    // B-2: el webhook YA NO activa el evento, solo marca el pago.
    expect(settled?.status).toBe("draft");
    expect(settled?.config.payment.status).toBe("paid");
    expect(confirmationJobs).toEqual([{ kind: "event_credits", eventId }]);
  });

  it("checkout.session.completed (event_credits) con importe distinto del congelado NO activa nada (B-1)", async () => {
    const { eventStore, events, post, confirmationJobs } = setup();
    const { eventId, purchaseId, sessionId } = await openEventCheckout(events);
    const res = await post(
      checkoutCompleted(
        "evt_7b",
        { purchaseType: "event_credits", purchaseId, eventId },
        "pi_7b",
        { sessionId, amountTotal: 1 },
      ),
    );
    expect(res.status).toBe(200);
    const settled = await eventStore.findEvent(eventId);
    expect(settled?.config.payment.status).toBe("pending");
    expect(confirmationJobs).toEqual([]);
  });

  it("payment_intent.payment_failed (event_credits) YA NO libera el checkout (B-1)", async () => {
    const { eventStore, events, post } = setup();
    const { eventId, sessionId } = await openEventCheckout(events, "Jornada escolar 2");
    const res = await post(paymentFailed("evt_8", { purchaseType: "event_credits", eventId }));
    expect(res.status).toBe(200);
    const settled = await eventStore.findEvent(eventId);
    expect(settled?.config.payment.checkoutRef).toBe(sessionId);
  });

  it("checkout.session.expired (event_credits) libera el checkout para reintentar", async () => {
    const { eventStore, events, post } = setup();
    const { eventId, sessionId } = await openEventCheckout(events, "Jornada escolar 3");
    const res = await post(checkoutExpired("evt_13", { purchaseType: "event_credits", eventId }, sessionId));
    expect(res.status).toBe(200);
    const settled = await eventStore.findEvent(eventId);
    expect(settled?.config.payment.checkoutRef).toBeNull();
  });

  it("charge.refunded (event_credits) tras pagar bloquea activate (B-5)", async () => {
    const { events, post } = setup();
    const { eventId, purchaseId, sessionId, amountTotal } = await openEventCheckout(events, "Jornada escolar 4");
    await post(
      checkoutCompleted(
        "evt_14a",
        { purchaseType: "event_credits", purchaseId, eventId },
        "pi_14",
        { sessionId, amountTotal },
      ),
    );
    const res = await post(chargeRefunded("evt_14b", "pi_14", { amount: amountTotal, amountRefunded: amountTotal }));
    expect(res.status).toBe(200);
    await expect(events.activate(organizer, eventId)).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
  });
});
