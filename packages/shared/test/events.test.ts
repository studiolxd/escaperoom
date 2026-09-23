import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  createEventService,
  createFakePaymentGateway,
  createInMemoryEventStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  EventError,
  type Actor,
  type EventRoomVersionRef,
  type PricingTierRow,
} from "../src/services";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const organizer: Actor = { userId: "profe", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };
const admin: Actor = { userId: "admin", organizationId: null, role: "member" };

const T0 = new Date("2026-01-01T00:00:00Z");
const tierId = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const VERSION = "10000000-0000-4000-8000-000000000001";
const NO_SALE_VERSION = "10000000-0000-4000-8000-000000000002";
const ARCHIVED_VERSION = "10000000-0000-4000-8000-000000000003";

/** Tramos iniciales de specs/02 §3.2, vigentes desde T0. */
function seedTiers(): PricingTierRow[] {
  return [
    [1, 15, 100],
    [16, 50, 90],
    [51, 150, 75],
    [151, null, 60],
  ].map(([min, max, price], i) => ({
    id: tierId(i + 1),
    minPlayers: min as number,
    maxPlayers: max as number | null,
    priceCentsPerPlayer: price as number,
    currency: "EUR",
    activeFrom: T0,
    activeUntil: null,
    createdBy: "seed-admin",
    createdAt: T0,
  }));
}

const version = (
  roomVersionId: string,
  over: Partial<EventRoomVersionRef> = {},
): EventRoomVersionRef => ({
  roomVersionId,
  roomId: "20000000-0000-4000-8000-000000000001",
  authorId: author.userId,
  roomStatus: "published",
  saleEvents: true,
  ...over,
});

function setup() {
  let clock = new Date("2026-06-01T10:00:00Z");
  const now = () => clock;
  const pricing = createPricingTierService({
    store: createInMemoryPricingTierStore({ adminIds: [admin.userId], tiers: seedTiers() }),
    now,
  });
  const store = createInMemoryEventStore({
    adminIds: [admin.userId],
    roomVersions: [
      version(VERSION),
      version(NO_SALE_VERSION, { saleEvents: false }),
      version(ARCHIVED_VERSION, { roomStatus: "archived" }),
    ],
  });
  const payments = createFakePaymentGateway();
  const events = createEventService({ store, pricing, payments, now });
  return {
    events,
    pricing,
    store,
    payments,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const baseInput = (over: Record<string, unknown> = {}) => ({
  roomVersionId: VERSION,
  title: "Jornada 3ºB",
  maxSimultaneousSessions: 5,
  groupingMode: "random",
  requireConfirmation: false,
  expiryRules: [{ type: "on_session_end" }],
  playersPlanned: 30,
  ...over,
});

async function rejects(p: Promise<unknown>, code: string): Promise<EventError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EventError);
  expect((err as EventError).code).toBe(code);
  return err as EventError;
}

describe("eventos — precio por tramos (specs/02 §3.2)", () => {
  it("un evento de 30 jugadores toma el tramo vigente (16–50 → 0,90 €) y guarda pricingSnapshot", async () => {
    const { events, store } = setup();
    const event = await events.createEvent(organizer, baseInput());

    expect(event.pricing).toMatchObject({
      tierId: tierId(2),
      players: 30,
      unitPriceCents: 90,
      totalCents: 2700,
      amountDueCents: 2700,
      currency: "EUR",
      selfSale: false,
    });
    expect(event.playersPurchased).toBe(30);
    expect(event.pricingSnapshot.capturedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(event.pricingSnapshot.tiers.map((t) => t.priceCentsPerPlayer)).toEqual([
      100, 90, 75, 60,
    ]);
    // Persistido tal cual en la fila (`event.pricingSnapshot`).
    expect(store.rows[0]?.pricingSnapshot).toEqual(event.pricingSnapshot);
  });

  it("120 alumnos ≈ 90 € (ejemplo de negocio)", async () => {
    const { events } = setup();
    const event = await events.createEvent(organizer, baseInput({ playersPlanned: 120 }));
    expect(event.pricing.totalCents).toBe(9000);
  });

  it("cambiar después el tramo (3.12) no altera el snapshot ni el precio del evento", async () => {
    const { events, pricing, advance } = setup();
    const created = await events.createEvent(organizer, baseInput());
    const snapshotBefore = structuredClone(created.pricingSnapshot);

    advance(60_000);
    await pricing.updateTier(admin, tierId(2), { priceCentsPerPlayer: 120 });
    advance(60_000);

    const reread = await events.getEvent(organizer, created.id);
    expect(reread.pricingSnapshot).toEqual(snapshotBefore);
    expect(reread.pricing.unitPriceCents).toBe(90);
    expect(reread.pricing.totalCents).toBe(2700);

    // Un evento nuevo sí ve el tramo nuevo.
    const fresh = await events.createEvent(organizer, baseInput());
    expect(fresh.pricing.unitPriceCents).toBe(120);
  });

  it("editar playersPlanned recalcula con el snapshot del evento, no con los tramos actuales", async () => {
    const { events, pricing, advance } = setup();
    const created = await events.createEvent(organizer, baseInput());
    advance(60_000);
    await pricing.updateTier(admin, tierId(3), { priceCentsPerPlayer: 10 });
    advance(60_000);

    const updated = await events.updateEvent(organizer, created.id, { playersPlanned: 60 });
    expect(updated.pricing).toMatchObject({ unitPriceCents: 75, totalCents: 4500 });
    expect(updated.pricingSnapshot).toEqual(created.pricingSnapshot);
  });

  it("sin tramo que cubra el nº de jugadores → PRICING_UNAVAILABLE", async () => {
    const { events, pricing } = setup();
    await pricing.updateTier(admin, tierId(4), { activeUntil: "2026-06-01T10:00:00Z" });
    await rejects(
      events.createEvent(organizer, baseInput({ playersPlanned: 200 })),
      "PRICING_UNAVAILABLE",
    );
  });
});

describe("eventos — validación", () => {
  it("maxSimultaneousSessions > 10 → VALIDATION_ERROR", async () => {
    const { events } = setup();
    const err = await rejects(
      events.createEvent(organizer, baseInput({ maxSimultaneousSessions: 11 })),
      "VALIDATION_ERROR",
    );
    expect(err.issues.map((i) => i.path)).toContain("maxSimultaneousSessions");
    await rejects(
      events.createEvent(organizer, baseInput({ maxSimultaneousSessions: 0 })),
      "VALIDATION_ERROR",
    );
  });

  it("10 sesiones es el máximo admitido", async () => {
    const { events } = setup();
    const event = await events.createEvent(organizer, baseInput({ maxSimultaneousSessions: 10 }));
    expect(event.maxSimultaneousSessions).toBe(10);
  });

  it("reglas de caducidad: tipos únicos y forma estricta", async () => {
    const { events } = setup();
    await rejects(
      events.createEvent(
        organizer,
        baseInput({ expiryRules: [{ type: "on_session_end" }, { type: "on_session_end" }] }),
      ),
      "VALIDATION_ERROR",
    );
    await rejects(
      events.createEvent(organizer, baseInput({ expiryRules: [{ type: "hours_after_start" }] })),
      "VALIDATION_ERROR",
    );
    const ok = await events.createEvent(
      organizer,
      baseInput({
        expiryRules: [
          { type: "hours_after_start", startsAt: "2026-06-10T09:00:00+02:00", hours: 8 },
          { type: "on_group_complete" },
        ],
      }),
    );
    expect(ok.expiryRules).toHaveLength(2);
  });

  it("la grabación no existe en eventos educativos", async () => {
    const { events } = setup();
    await rejects(
      events.createEvent(organizer, baseInput({ audience: "educational", recordingEnabled: true })),
      "VALIDATION_ERROR",
    );
    const general = await events.createEvent(organizer, baseInput({ recordingEnabled: true }));
    expect(general.config.recordingAcceptedAt).toBe("2026-06-01T10:00:00.000Z");
    await rejects(
      events.updateEvent(organizer, general.id, { audience: "educational" }),
      "VALIDATION_ERROR",
    );
  });

  it("vídeo desactivado por defecto (specs/12 §4)", async () => {
    const { events } = setup();
    const event = await events.createEvent(organizer, baseInput());
    expect(event.config.allowVideo).toBe(false);
    expect(event.audience).toBe("general");
  });

  it("valida saleEvents para terceros y exige sala publicada", async () => {
    const { events } = setup();
    await rejects(
      events.createEvent(organizer, baseInput({ roomVersionId: NO_SALE_VERSION })),
      "SALE_EVENTS_DISABLED",
    );
    await rejects(
      events.createEvent(organizer, baseInput({ roomVersionId: ARCHIVED_VERSION })),
      "ROOM_VERSION_UNAVAILABLE",
    );
    await rejects(
      events.createEvent(
        organizer,
        baseInput({ roomVersionId: "10000000-0000-4000-8000-0000000000ff" }),
      ),
      "ROOM_VERSION_UNAVAILABLE",
    );
    // El autor sí monta eventos sobre su sala aunque no la venda para eventos.
    const own = await events.createEvent(author, baseInput({ roomVersionId: NO_SALE_VERSION }));
    expect(own.pricing.selfSale).toBe(true);
  });
});

describe("eventos — autoventa y pago", () => {
  it("autoventa del autor: gratis, sin checkout y activable", async () => {
    const { events, payments } = setup();
    const event = await events.createEvent(author, baseInput());
    expect(event.pricing).toMatchObject({ selfSale: true, amountDueCents: 0, totalCents: 2700 });
    expect(event.config.payment.status).toBe("not_required");
    expect(event.activatable).toBe(true);

    await rejects(events.startCheckout(author, event.id), "CHECKOUT_NOT_REQUIRED");
    expect(payments.calls).toHaveLength(0);

    const active = await events.activate(author, event.id);
    expect(active.status).toBe("active");
    expect(active.activatable).toBe(false);
    await rejects(events.updateEvent(author, event.id, { title: "x" }), "EVENT_NOT_EDITABLE");
  });

  it("evento ajeno: pendiente de pago, no activable hasta pagar", async () => {
    const { events, payments } = setup();
    const event = await events.createEvent(organizer, baseInput());
    expect(event.status).toBe("draft");
    expect(event.config.payment).toEqual({ status: "pending", checkoutRef: null, paidAt: null });
    expect(event.activatable).toBe(false);
    await rejects(events.activate(organizer, event.id), "PAYMENT_REQUIRED");

    const { checkoutUrl, event: withCheckout } = await events.startCheckout(organizer, event.id);
    expect(checkoutUrl).toContain("fake_cs_1");
    expect(payments.calls).toEqual([
      {
        eventId: event.id,
        organizerId: organizer.userId,
        title: "Jornada 3ºB",
        players: 30,
        amountCents: 2700,
        currency: "EUR",
      },
    ]);
    expect(withCheckout.config.payment.checkoutRef).toBe("fake_cs_1");
    // Con checkout abierto el nº de jugadores ya no cambia (el importe está en la pasarela).
    await rejects(
      events.updateEvent(organizer, event.id, { playersPlanned: 40 }),
      "EVENT_NOT_EDITABLE",
    );

    // El webhook de Stripe (5.1) llama a `markPaid` al confirmar el pago, que
    // activa el evento en la misma escritura (specs/13 §7): no hace falta un
    // `activate` explícito del organizador.
    const paid = await events.markPaid(event.id);
    expect(paid.config.payment.status).toBe("paid");
    expect(paid.status).toBe("active");
    await rejects(events.activate(organizer, event.id), "EVENT_NOT_EDITABLE");
  });

  it("sin pasarela cableada el checkout responde PAYMENT_GATEWAY_UNAVAILABLE", async () => {
    const { store, pricing } = setup();
    const events = createEventService({ store, pricing, payments: null });
    const event = await events.createEvent(organizer, baseInput());
    await rejects(events.startCheckout(organizer, event.id), "PAYMENT_GATEWAY_UNAVAILABLE");
  });
});

describe("eventos — permisos y lectura", () => {
  it("anónimo → UNAUTHORIZED en todas las operaciones", async () => {
    const { events } = setup();
    const event = await events.createEvent(organizer, baseInput());
    await rejects(events.createEvent(ANONYMOUS_ACTOR, baseInput()), "UNAUTHORIZED");
    await rejects(events.getEvent(ANONYMOUS_ACTOR, event.id), "UNAUTHORIZED");
    await rejects(events.updateEvent(ANONYMOUS_ACTOR, event.id, { title: "x" }), "UNAUTHORIZED");
    await rejects(events.listMyEvents(ANONYMOUS_ACTOR), "UNAUTHORIZED");
    await rejects(events.activate(ANONYMOUS_ACTOR, event.id), "UNAUTHORIZED");
  });

  it("otro usuario → FORBIDDEN; el admin puede leer pero no editar", async () => {
    const { events } = setup();
    const event = await events.createEvent(organizer, baseInput());
    await rejects(events.getEvent(other, event.id), "FORBIDDEN");
    await rejects(events.updateEvent(other, event.id, { title: "x" }), "FORBIDDEN");
    await rejects(events.startCheckout(other, event.id), "FORBIDDEN");
    await rejects(events.activate(other, event.id), "FORBIDDEN");

    const asAdmin = await events.getEvent(admin, event.id);
    expect(asAdmin.summary).toEqual({ sessions: 0, accessKeysByStatus: {} });
    await rejects(events.updateEvent(admin, event.id, { title: "x" }), "FORBIDDEN");
  });

  it("id inexistente o mal formado → NOT_FOUND", async () => {
    const { events } = setup();
    await rejects(events.getEvent(organizer, "no-es-uuid"), "NOT_FOUND");
    await rejects(events.getEvent(organizer, "30000000-0000-4000-8000-000000000001"), "NOT_FOUND");
  });

  it("PATCH edita la configuración en draft", async () => {
    const { events } = setup();
    const event = await events.createEvent(organizer, baseInput());
    const updated = await events.updateEvent(organizer, event.id, {
      title: "  Jornada 3ºB (tarde) ",
      groupingMode: "free",
      maxSimultaneousSessions: 10,
      allowVideo: true,
    });
    expect(updated).toMatchObject({
      title: "Jornada 3ºB (tarde)",
      groupingMode: "free",
      maxSimultaneousSessions: 10,
    });
    expect(updated.config.allowVideo).toBe(true);
    await rejects(
      events.updateEvent(organizer, event.id, { maxSimultaneousSessions: 11 }),
      "VALIDATION_ERROR",
    );
    await rejects(events.updateEvent(organizer, event.id, {}), "VALIDATION_ERROR");
  });

  it("listMyEvents pagina por cursor solo los eventos propios, más recientes primero", async () => {
    const { events } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push((await events.createEvent(organizer, baseInput({ title: `E${i}` }))).id);
      await new Promise((r) => setTimeout(r, 2));
    }
    await events.createEvent(other, baseInput());

    const page1 = await events.listMyEvents(organizer, { limit: "2" });
    expect(page1.items.map((e) => e.title)).toEqual(["E4", "E3"]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await events.listMyEvents(organizer, { limit: 2, cursor: page1.nextCursor });
    const page3 = await events.listMyEvents(organizer, { limit: 2, cursor: page2.nextCursor });
    expect([...page2.items, ...page3.items].map((e) => e.title)).toEqual(["E2", "E1", "E0"]);
    expect(page3.nextCursor).toBeNull();

    await rejects(events.listMyEvents(organizer, { cursor: "basura" }), "VALIDATION_ERROR");
  });
});
