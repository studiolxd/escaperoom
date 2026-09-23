import { describe, expect, it } from "vitest";
import {
  AdminError,
  ANONYMOUS_ACTOR,
  createInMemoryPricingTierStore,
  createPricingTierService,
  quotePricing,
  type Actor,
  type PricingSnapshot,
  type PricingTierRow,
} from "../src/services";

const admin: Actor = { userId: "admin", organizationId: null, role: "member" };
const user: Actor = { userId: "usuaria", organizationId: null, role: "member" };

const T0 = new Date("2026-01-01T00:00:00Z");
const tierId = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

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

function setup() {
  let clock = new Date("2026-06-01T10:00:00Z");
  const store = createInMemoryPricingTierStore({ adminIds: [admin.userId], tiers: seedTiers() });
  const pricing = createPricingTierService({ store, now: () => clock });
  /** Eventos ya creados: guardan el snapshot como JSON (igual que `event.pricingSnapshot`). */
  const events: Array<{ id: string; pricingSnapshot: unknown }> = [];
  return {
    pricing,
    events,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
    get now() {
      return clock;
    },
    async createEvent(id: string) {
      const snapshot = await pricing.snapshotAt(clock);
      events.push({ id, pricingSnapshot: JSON.parse(JSON.stringify(snapshot)) });
    },
  };
}

async function codeOf(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AdminError);
  return (err as AdminError).code;
}

describe("pricingTier — tramos versionados", () => {
  it("modificar un tramo NO altera el pricingSnapshot de un evento ya creado", async () => {
    const t = setup();
    await t.createEvent("instituto");
    const before = structuredClone(t.events[0]!.pricingSnapshot);
    expect(quotePricing(before as PricingSnapshot, 120)).toMatchObject({
      unitPriceCents: 75,
      totalCents: 9000,
    });

    t.advance(1000);
    const { closed, created } = await t.pricing.updateTier(admin, tierId(3), {
      priceCentsPerPlayer: 70,
    });

    // El evento conserva su snapshot byte a byte y su total.
    expect(t.events[0]!.pricingSnapshot).toEqual(before);
    expect(quotePricing(t.events[0]!.pricingSnapshot as PricingSnapshot, 120)?.totalCents).toBe(
      9000,
    );

    // La fila original sigue ahí, intacta salvo su cierre; la sucesora lleva el cambio.
    expect(closed).toMatchObject({ id: tierId(3), priceCentsPerPlayer: 75, activeUntil: t.now });
    expect(created).toMatchObject({
      minPlayers: 51,
      maxPlayers: 150,
      priceCentsPerPlayer: 70,
      activeFrom: t.now,
      activeUntil: null,
      createdBy: admin.userId,
    });

    // Un evento nuevo ya ve el precio nuevo; el histórico se consulta por fecha.
    await t.createEvent("empresa");
    expect(quotePricing(t.events[1]!.pricingSnapshot as PricingSnapshot, 120)?.totalCents).toBe(
      8400,
    );
    const past = await t.pricing.snapshotAt(new Date("2026-03-01T00:00:00Z"));
    expect(quotePricing(past, 120)?.unitPriceCents).toBe(75);

    const all = await t.pricing.listTiers(admin);
    expect(all).toHaveLength(5);
    expect(await t.pricing.listTiers(admin, { status: "closed" })).toHaveLength(1);
    expect(await t.pricing.listTiers(admin, { status: "active" })).toHaveLength(4);
  });

  it("un tramo cerrado es histórico: no se vuelve a modificar (CONFLICT)", async () => {
    const t = setup();
    await t.pricing.updateTier(admin, tierId(1), { priceCentsPerPlayer: 95 });
    expect(await codeOf(t.pricing.updateTier(admin, tierId(1), { priceCentsPerPlayer: 10 }))).toBe(
      "CONFLICT",
    );
    expect(
      await codeOf(t.pricing.updateTier(admin, tierId(1), { activeUntil: t.now.toISOString() })),
    ).toBe("CONFLICT");
  });

  it("cambio programado: el precio viejo rige hasta effectiveFrom", async () => {
    const t = setup();
    const from = new Date(t.now.getTime() + 24 * 3600 * 1000);
    await t.pricing.updateTier(admin, tierId(2), {
      priceCentsPerPlayer: 85,
      effectiveFrom: from.toISOString(),
    });
    expect(quotePricing(await t.pricing.snapshotAt(t.now), 20)?.unitPriceCents).toBe(90);
    expect(quotePricing(await t.pricing.snapshotAt(from), 20)?.unitPriceCents).toBe(85);
    expect(await t.pricing.listTiers(admin, { status: "scheduled" })).toHaveLength(1);
  });

  it("retirar un tramo con activeUntil (sin sucesor) y crear otro después sin solape", async () => {
    const t = setup();
    const at = new Date(t.now.getTime() + 3600_000);
    const { closed, created } = await t.pricing.updateTier(admin, tierId(4), {
      activeUntil: at.toISOString(),
    });
    expect(closed.activeUntil).toEqual(at);
    expect(created).toBeNull();

    // Antes del cierre, 151–300 se solapa con 151+ → CONFLICT; desde el cierre, cabe.
    expect(
      await codeOf(
        t.pricing.createTier(admin, { minPlayers: 151, maxPlayers: 300, priceCentsPerPlayer: 55 }),
      ),
    ).toBe("CONFLICT");
    const tier = await t.pricing.createTier(admin, {
      minPlayers: 151,
      maxPlayers: 300,
      priceCentsPerPlayer: 55,
      activeFrom: at.toISOString(),
    });
    expect(tier).toMatchObject({ currency: "EUR", activeFrom: at, createdBy: admin.userId });
  });

  it("un cambio de rango que pisa a un tramo vecino vigente → CONFLICT sin tocar nada", async () => {
    const t = setup();
    expect(await codeOf(t.pricing.updateTier(admin, tierId(1), { maxPlayers: 20 }))).toBe(
      "CONFLICT",
    );
    expect(await t.pricing.listTiers(admin, { status: "closed" })).toHaveLength(0);
  });

  it.each([
    ["min > max", { minPlayers: 10, maxPlayers: 5, priceCentsPerPlayer: 1 }],
    ["precio negativo", { minPlayers: 400, priceCentsPerPlayer: -1 }],
    ["precio no entero", { minPlayers: 400, priceCentsPerPlayer: 1.5 }],
    ["moneda inválida", { minPlayers: 400, priceCentsPerPlayer: 1, currency: "eur" }],
    ["campo desconocido", { minPlayers: 400, priceCentsPerPlayer: 1, foo: 1 }],
    [
      "activeFrom en el pasado",
      { minPlayers: 400, priceCentsPerPlayer: 1, activeFrom: "2020-01-01T00:00:00Z" },
    ],
  ])("POST inválido (%s) → VALIDATION_ERROR", async (_label, input) => {
    const t = setup();
    expect(await codeOf(t.pricing.createTier(admin, input))).toBe("VALIDATION_ERROR");
  });

  it.each([
    ["sin cambios", {}],
    [
      "retirada combinada con cambios",
      { activeUntil: "2030-01-01T00:00:00Z", priceCentsPerPlayer: 1 },
    ],
    [
      "effectiveFrom en el pasado",
      { priceCentsPerPlayer: 1, effectiveFrom: "2020-01-01T00:00:00Z" },
    ],
    ["max < min resultante", { maxPlayers: 10 }],
  ])("PATCH inválido (%s) → VALIDATION_ERROR", async (_label, input) => {
    const t = setup();
    expect(await codeOf(t.pricing.updateTier(admin, tierId(2), input))).toBe("VALIDATION_ERROR");
  });

  it("tramo inexistente o id no-uuid → NOT_FOUND", async () => {
    const t = setup();
    expect(
      await codeOf(
        t.pricing.updateTier(admin, "99999999-9999-4999-8999-999999999999", {
          priceCentsPerPlayer: 1,
        }),
      ),
    ).toBe("NOT_FOUND");
    expect(await codeOf(t.pricing.updateTier(admin, "x", { priceCentsPerPlayer: 1 }))).toBe(
      "NOT_FOUND",
    );
  });

  it("no admin → FORBIDDEN; sin sesión → UNAUTHORIZED", async () => {
    const t = setup();
    expect(await codeOf(t.pricing.listTiers(user))).toBe("FORBIDDEN");
    expect(await codeOf(t.pricing.createTier(user, {}))).toBe("FORBIDDEN");
    expect(await codeOf(t.pricing.updateTier(user, tierId(1), {}))).toBe("FORBIDDEN");
    expect(await codeOf(t.pricing.listTiers(ANONYMOUS_ACTOR))).toBe("UNAUTHORIZED");
  });

  it("dos cambios concurrentes del mismo tramo: uno gana y el otro choca (lock)", async () => {
    const t = setup();
    const results = await Promise.allSettled([
      t.pricing.updateTier(admin, tierId(1), { priceCentsPerPlayer: 99 }),
      t.pricing.updateTier(admin, tierId(1), { priceCentsPerPlayer: 98 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await t.pricing.listTiers(admin, { status: "active" })).toHaveLength(4);
  });

  it("quotePricing: tramo por nº de jugadores y null si ninguno cubre", async () => {
    const t = setup();
    const snap = await t.pricing.snapshotAt();
    expect(quotePricing(snap, 15)?.unitPriceCents).toBe(100);
    expect(quotePricing(snap, 16)?.unitPriceCents).toBe(90);
    expect(quotePricing(snap, 1000)?.unitPriceCents).toBe(60);
    expect(quotePricing({ ...snap, tiers: [] }, 10)).toBeNull();
  });
});
