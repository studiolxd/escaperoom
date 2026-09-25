import {
  ANONYMOUS_ACTOR,
  createEventService,
  createFakePaymentGateway,
  createInMemoryEventStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  type Actor,
  type PaymentGateway,
  type PricingTierRow,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createEventHandlers } from "../src/server/rest/events";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const organizer: Actor = { userId: "profe", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };
const admin: Actor = { userId: "admin", organizationId: null, role: "member" };

const VERSION = "10000000-0000-4000-8000-000000000001";
const TIER_ID = "00000000-0000-4000-8000-000000000002";
const T0 = new Date("2026-01-01T00:00:00Z");

type EventJson = {
  id: string;
  status: string;
  playersPlanned: number;
  activatable: boolean;
  pricingSnapshot: { capturedAt: string; tiers: Array<{ priceCentsPerPlayer: number }> };
  pricing: {
    unitPriceCents: number;
    totalCents: number;
    amountDueCents: number;
    selfSale: boolean;
  };
  payment: { status: string };
  summary?: unknown;
};
type ErrorJson = { error: { code: string; issues?: Array<{ path: string }> } };

const tier: PricingTierRow = {
  id: TIER_ID,
  minPlayers: 16,
  maxPlayers: 50,
  priceCentsPerPlayer: 90,
  currency: "EUR",
  activeFrom: T0,
  activeUntil: null,
  createdBy: "seed-admin",
  createdAt: T0,
};

/** Handlers REST con stores en memoria; el actor viaja en una cabecera de test. */
function setup(payments: PaymentGateway | null = createFakePaymentGateway()) {
  let clock = new Date("2026-06-01T10:00:00Z");
  const now = () => clock;
  const pricing = createPricingTierService({
    store: createInMemoryPricingTierStore({ adminIds: [admin.userId], tiers: [tier] }),
    now,
  });
  const events = createEventService({
    store: createInMemoryEventStore({
      adminIds: [admin.userId],
      roomVersions: [
        {
          roomVersionId: VERSION,
          roomId: "20000000-0000-4000-8000-000000000001",
          authorId: author.userId,
          roomStatus: "published",
          saleEvents: true,
        },
      ],
    }),
    pricing,
    payments,
    now,
  });
  const actors: Record<string, Actor> = {
    autora: author,
    profe: organizer,
    otra: other,
    admin,
  };
  const handlers = createEventHandlers({
    events,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
    buildUrls: (eventId) => ({
      successUrl: `https://app.test/success?eventId=${eventId}`,
      cancelUrl: `https://app.test/cancel?eventId=${eventId}`,
    }),
  });
  const req = (
    path: string,
    init: { method?: string; user?: string; body?: unknown; raw?: string } = {},
  ) =>
    new Request(`http://localhost/api/${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(init.user ? { "x-test-user": init.user } : {}),
      },
      body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });
  const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

  return {
    pricing,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    create: (body: unknown, user?: string, raw?: string) =>
      handlers.createEvent(req("events", { method: "POST", user, body, raw })),
    get: (id: string, user?: string) => handlers.getEvent(req(`events/${id}`, { user }), idCtx(id)),
    patch: (id: string, body: unknown, user?: string) =>
      handlers.patchEvent(req(`events/${id}`, { method: "PATCH", user, body }), idCtx(id)),
    checkout: (id: string, user?: string) =>
      handlers.postCheckout(req(`events/${id}/checkout`, { method: "POST", user }), idCtx(id)),
    activate: (id: string, user?: string) =>
      handlers.postActivate(req(`events/${id}/activate`, { method: "POST", user }), idCtx(id)),
    listMine: (query: string, user?: string) =>
      handlers.listMyEvents(req(`me/events${query}`, { user })),
  };
}

const body = (over: Record<string, unknown> = {}) => ({
  roomVersionId: VERSION,
  title: "Team building",
  maxSimultaneousSessions: 3,
  groupingMode: "specific",
  requireConfirmation: true,
  expiryRules: [],
  playersPlanned: 30,
  ...over,
});

async function created(res: Response): Promise<EventJson> {
  expect(res.status).toBe(201);
  return (await res.json()) as EventJson;
}

describe("POST /api/events", () => {
  it("201: 30 jugadores → tramo vigente (0,90 €) y pricingSnapshot guardado", async () => {
    const t = setup();
    const event = await created(await t.create(body(), "profe"));
    expect(event).toMatchObject({
      status: "draft",
      playersPlanned: 30,
      activatable: false,
      payment: { status: "pending" },
      pricing: { unitPriceCents: 90, totalCents: 2700, amountDueCents: 2700, selfSale: false },
    });
    expect(event.pricingSnapshot.tiers).toHaveLength(1);
  });

  it("el snapshot no cambia al cambiar después el tramo", async () => {
    const t = setup();
    const event = await created(await t.create(body(), "profe"));
    t.advance(60_000);
    await t.pricing.updateTier(admin, TIER_ID, { priceCentsPerPlayer: 200 });

    const res = await t.get(event.id, "profe");
    expect(res.status).toBe(200);
    const reread = (await res.json()) as EventJson;
    expect(reread.pricingSnapshot).toEqual(event.pricingSnapshot);
    expect(reread.pricing.totalCents).toBe(2700);
    expect(reread.summary).toEqual({ sessions: 0, accessKeysByStatus: {} });
  });

  it("422 con maxSimultaneousSessions > 10", async () => {
    const t = setup();
    const res = await t.create(body({ maxSimultaneousSessions: 11 }), "profe");
    expect(res.status).toBe(422);
    const json = (await res.json()) as ErrorJson;
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.issues?.map((i) => i.path)).toContain("maxSimultaneousSessions");
  });

  it("401 sin sesión (antes de mirar el cuerpo) y 400 con JSON roto", async () => {
    const t = setup();
    const anon = await t.create(undefined, undefined, "{roto");
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as ErrorJson).error.code).toBe("UNAUTHORIZED");
    expect((await t.create(undefined, "profe", "{roto")).status).toBe(400);
  });

  it("autoventa del autor: gratis, sin checkout y activable", async () => {
    const t = setup();
    const event = await created(await t.create(body(), "autora"));
    expect(event).toMatchObject({
      activatable: true,
      payment: { status: "not_required" },
      pricing: { amountDueCents: 0, selfSale: true },
    });
    const checkout = await t.checkout(event.id, "autora");
    expect(checkout.status).toBe(409);
    expect(((await checkout.json()) as ErrorJson).error.code).toBe("CHECKOUT_NOT_REQUIRED");

    const activated = await t.activate(event.id, "autora");
    expect(activated.status).toBe(200);
    expect(((await activated.json()) as EventJson).status).toBe("active");
  });
});

describe("eventos ajenos: pendiente de pago", () => {
  it("activar sin pagar → 409 PAYMENT_REQUIRED; checkout por la pasarela falsa", async () => {
    const payments = createFakePaymentGateway();
    const t = setup(payments);
    const event = await created(await t.create(body(), "profe"));

    const activate = await t.activate(event.id, "profe");
    expect(activate.status).toBe(409);
    expect(((await activate.json()) as ErrorJson).error.code).toBe("PAYMENT_REQUIRED");

    const res = await t.checkout(event.id, "profe");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { checkoutUrl: string };
    expect(json.checkoutUrl).toMatch(/^https:\/\/checkout\.example\.test\//);
    expect(payments.calls[0]).toMatchObject({ eventId: event.id, amountCents: 2700 });
  });

  it("sin pasarela cableada → 501 PAYMENT_GATEWAY_UNAVAILABLE", async () => {
    const t = setup(null);
    const event = await created(await t.create(body(), "profe"));
    const res = await t.checkout(event.id, "profe");
    expect(res.status).toBe(501);
    expect(((await res.json()) as ErrorJson).error.code).toBe("PAYMENT_GATEWAY_UNAVAILABLE");
  });
});

describe("permisos 401/403 en lectura y edición", () => {
  it("GET: 401 anónimo, 403 ajeno, 200 organizador y admin, 404 inexistente", async () => {
    const t = setup();
    const event = await created(await t.create(body(), "profe"));
    expect((await t.get(event.id)).status).toBe(401);
    expect((await t.get(event.id, "otra")).status).toBe(403);
    expect((await t.get(event.id, "profe")).status).toBe(200);
    expect((await t.get(event.id, "admin")).status).toBe(200);
    expect((await t.get("30000000-0000-4000-8000-000000000009", "profe")).status).toBe(404);
  });

  it("PATCH: 401/403, 200 en draft y 409 una vez activo", async () => {
    const t = setup();
    const event = await created(await t.create(body(), "autora"));
    expect((await t.patch(event.id, { title: "x" })).status).toBe(401);
    expect((await t.patch(event.id, { title: "x" }, "otra")).status).toBe(403);
    expect((await t.patch(event.id, { title: "x" }, "admin")).status).toBe(403);
    expect((await t.patch(event.id, { maxSimultaneousSessions: 11 }, "autora")).status).toBe(422);

    const ok = await t.patch(event.id, { playersPlanned: 40 }, "autora");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as EventJson).pricing.totalCents).toBe(3600);

    await t.activate(event.id, "autora");
    const locked = await t.patch(event.id, { title: "y" }, "autora");
    expect(locked.status).toBe(409);
    expect(((await locked.json()) as ErrorJson).error.code).toBe("EVENT_NOT_EDITABLE");
  });

  it("checkout y activate: 401 anónimo, 403 ajeno", async () => {
    const t = setup();
    const event = await created(await t.create(body(), "profe"));
    expect((await t.checkout(event.id)).status).toBe(401);
    expect((await t.checkout(event.id, "otra")).status).toBe(403);
    expect((await t.activate(event.id)).status).toBe(401);
    expect((await t.activate(event.id, "otra")).status).toBe(403);
  });
});

describe("GET /api/me/events", () => {
  it("401 sin sesión; lista solo los propios con nextCursor", async () => {
    const t = setup();
    await t.create(body({ title: "A" }), "profe");
    await new Promise((r) => setTimeout(r, 2));
    await t.create(body({ title: "B" }), "profe");
    await t.create(body({ title: "C" }), "otra");

    expect((await t.listMine("")).status).toBe(401);
    const res = await t.listMine("?limit=1", "profe");
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: Array<{ title: string }>; nextCursor: string };
    expect(page.items.map((e) => e.title)).toEqual(["B"]);
    const next = (await (
      await t.listMine(`?limit=1&cursor=${page.nextCursor}`, "profe")
    ).json()) as { items: Array<{ title: string }>; nextCursor: string | null };
    expect(next.items.map((e) => e.title)).toEqual(["A"]);
    expect(next.nextCursor).toBeNull();
    expect((await t.listMine("?limit=0", "profe")).status).toBe(422);
  });
});
