import {
  ANONYMOUS_ACTOR,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryPricingTierStore,
  createPricingTierService,
  type Actor,
  type PricingTierRow,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createAccessKeyHandlers } from "../src/server/rest/access-keys";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");

type KeyJson = {
  code: string;
  type: string;
  status: string;
  seats: number;
  redeemedCount: number;
  regeneratedFrom: string | null;
};
type ErrorJson = { error: { code: string; issues?: Array<{ path: string }> } };

const tier: PricingTierRow = {
  id: "00000000-0000-4000-8000-000000000001",
  minPlayers: 1,
  maxPlayers: null,
  priceCentsPerPlayer: 100,
  currency: "EUR",
  activeFrom: T0,
  activeUntil: null,
  createdBy: "seed-admin",
  createdAt: T0,
};

/** Handlers REST con stores en memoria; el actor viaja en una cabecera de test. */
function setup() {
  const now = () => new Date("2026-06-01T10:00:00Z");
  const pricing = createPricingTierService({
    store: createInMemoryPricingTierStore({ adminIds: [], tiers: [tier] }),
    now,
  });
  const eventStore = createInMemoryEventStore({
    roomVersions: [
      {
        roomVersionId: VERSION,
        roomId: "20000000-0000-4000-8000-000000000001",
        authorId: author.userId,
        roomStatus: "published",
        saleEvents: true,
      },
    ],
  });
  const events = createEventService({
    store: eventStore,
    pricing,
    payments: createFakePaymentGateway(),
    now,
  });
  const accessKeys = createAccessKeyService({
    store: createInMemoryAccessKeyStore({ events: eventStore }),
    events,
    now,
  });
  const actors: Record<string, Actor> = { autora: author, otra: other };
  const handlers = createAccessKeyHandlers({
    accessKeys,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
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
    accessKeys,
    createEvent: (over: Record<string, unknown> = {}) =>
      events.createEvent(author, {
        roomVersionId: VERSION,
        title: "Jornada",
        maxSimultaneousSessions: 2,
        groupingMode: "free",
        requireConfirmation: false,
        expiryRules: [],
        playersPlanned: 20,
        ...over,
      }),
    activate: (id: string, user?: string, body?: unknown, raw?: string) =>
      handlers.postActivate(
        req(`events/${id}/activate`, { method: "POST", user, body, raw }),
        idCtx(id),
      ),
    generate: (id: string, body: unknown, user?: string) =>
      handlers.postAccessKeys(
        req(`events/${id}/access-keys`, { method: "POST", user, body }),
        idCtx(id),
      ),
    list: (id: string, query: string, user?: string) =>
      handlers.listAccessKeys(req(`events/${id}/access-keys${query}`, { user }), idCtx(id)),
    regenerate: (code: string, user?: string) =>
      handlers.postRegenerate(
        req(`access-keys/${encodeURIComponent(code)}/regenerate`, { method: "POST", user }),
        { params: Promise.resolve({ code: encodeURIComponent(code) }) },
      ),
  };
}

describe("POST /api/events/:id/activate (con generación de claves)", () => {
  it("200 sin cuerpo: evento activo, sesiones creadas y playersPlanned claves", async () => {
    const t = setup();
    const event = await t.createEvent();
    const res = await t.activate(event.id, "autora");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      sessions: Array<{ name: string; capacity: number }>;
      accessKeys: { generated: number };
    };
    expect(json.status).toBe("active");
    expect(json.sessions).toHaveLength(2);
    expect(json.accessKeys.generated).toBe(20);
  });

  it("409 SEAT_LIMIT_EXCEEDED si el plan supera lo comprado; 400 con JSON roto", async () => {
    const t = setup();
    const event = await t.createEvent();
    const res = await t.activate(event.id, "autora", {
      keyPlan: [{ type: "group", count: 3, seats: 10 }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorJson).error.code).toBe("SEAT_LIMIT_EXCEEDED");
    expect((await t.activate(event.id, "autora", undefined, "{roto")).status).toBe(400);
  });

  it("401 anónimo, 403 ajeno y 409 EVENT_NOT_EDITABLE si ya estaba activo", async () => {
    const t = setup();
    const event = await t.createEvent();
    expect((await t.activate(event.id)).status).toBe(401);
    expect((await t.activate(event.id, "otra")).status).toBe(403);
    expect((await t.activate(event.id, "autora")).status).toBe(200);
    const again = await t.activate(event.id, "autora");
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorJson).error.code).toBe("EVENT_NOT_EDITABLE");
  });
});

describe("claves del evento (specs/13 §6.2)", () => {
  async function active() {
    const t = setup();
    const event = await t.createEvent();
    await t.activate(event.id, "autora", { keyPlan: [{ type: "individual", count: 5 }] });
    return { ...t, event };
  }

  it("POST 201 genera un lote; GET lista con asientos y pagina", async () => {
    const t = await active();
    const res = await t.generate(t.event.id, { type: "batch", count: 10 }, "autora");
    expect(res.status).toBe(201);
    const { items } = (await res.json()) as { items: KeyJson[] };
    expect(items).toHaveLength(10);
    expect(new Set(items.map((k) => k.code)).size).toBe(10);

    const page = await t.list(t.event.id, "?limit=10", "autora");
    const json = (await page.json()) as {
      items: KeyJson[];
      nextCursor: string | null;
      seats: unknown;
    };
    expect(json.items).toHaveLength(10);
    expect(json.nextCursor).not.toBeNull();
    expect(json.seats).toEqual({ purchased: 20, committed: 15, available: 5 });
  });

  it("409 SEAT_LIMIT_EXCEEDED al pasarse de playersPlanned; 422 con cuerpo inválido", async () => {
    const t = await active();
    const over = await t.generate(t.event.id, { type: "group", count: 1, seats: 16 }, "autora");
    expect(over.status).toBe(409);
    expect(((await over.json()) as ErrorJson).error.code).toBe("SEAT_LIMIT_EXCEEDED");
    const bad = await t.generate(t.event.id, { type: "rotating", count: 1 }, "autora");
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as ErrorJson).error.issues?.[0]?.path).toBe("seats");
  });

  it("solo el organizador: 401/403 al generar, listar y regenerar", async () => {
    const t = await active();
    expect((await t.generate(t.event.id, { type: "individual", count: 1 })).status).toBe(401);
    expect((await t.generate(t.event.id, { type: "individual", count: 1 }, "otra")).status).toBe(
      403,
    );
    expect((await t.list(t.event.id, "", "otra")).status).toBe(403);
    expect((await t.list(t.event.id, "")).status).toBe(401);
    const res = await t.generate(t.event.id, { type: "rotating", count: 1, seats: 4 }, "autora");
    const [rotating] = ((await res.json()) as { items: KeyJson[] }).items;
    expect((await t.regenerate(rotating!.code, "otra")).status).toBe(403);
    expect((await t.regenerate(rotating!.code)).status).toBe(401);
  });

  it("POST /api/access-keys/:code/regenerate rota la rotativa y rechaza las demás", async () => {
    const t = await active();
    const res = await t.generate(t.event.id, { type: "rotating", count: 1, seats: 4 }, "autora");
    const [rotating] = ((await res.json()) as { items: KeyJson[] }).items;
    await t.accessKeys.consumeSeat(rotating!.code);

    const rotated = await t.regenerate(rotating!.code, "autora");
    expect(rotated.status).toBe(201);
    expect(await rotated.json()).toMatchObject({
      regeneratedFrom: rotating!.code,
      type: "rotating",
      seats: 3,
      redeemedCount: 0,
    });
    const again = await t.regenerate(rotating!.code, "autora");
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorJson).error.code).toBe("ACCESS_KEY_EXPIRED");

    const list = (await (await t.list(t.event.id, "?status=active", "autora")).json()) as {
      items: KeyJson[];
    };
    const individual = list.items.find((k) => k.type === "individual")!;
    const notRotating = await t.regenerate(individual.code, "autora");
    expect(notRotating.status).toBe(409);
    expect(((await notRotating.json()) as ErrorJson).error.code).toBe("ACCESS_KEY_NOT_ROTATING");
    expect((await t.regenerate("ZZZZ-ZZZZ-ZZZZ", "autora")).status).toBe(404);
  });
});
