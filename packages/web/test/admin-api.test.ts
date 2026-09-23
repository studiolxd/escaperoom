import {
  ANONYMOUS_ACTOR,
  createInMemoryPlatformSettingStore,
  createInMemoryPricingTierStore,
  createPlatformSettingsService,
  createPricingTierService,
  quotePricing,
  type Actor,
  type PricingSnapshot,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createAdminHandlers } from "../src/server/rest/admin";

const admin: Actor = { userId: "admin", organizationId: null, role: "member" };
const user: Actor = { userId: "usuaria", organizationId: null, role: "member" };
const TIER_ID = "00000000-0000-4000-8000-000000000003";

type TierJson = {
  id: string;
  priceCentsPerPlayer: number;
  status: string;
  activeUntil: string | null;
};

/** Handlers REST con stores en memoria; el actor viaja en una cabecera de test. */
function setup() {
  const adminIds = [admin.userId];
  const settings = createPlatformSettingsService({
    store: createInMemoryPlatformSettingStore({
      adminIds,
      rows: [{ key: "maxPlayersPerRoom", value: 6, updatedBy: null, updatedAt: new Date(0) }],
    }),
  });
  const pricing = createPricingTierService({
    store: createInMemoryPricingTierStore({
      adminIds,
      tiers: [
        {
          id: TIER_ID,
          minPlayers: 51,
          maxPlayers: 150,
          priceCentsPerPlayer: 75,
          currency: "EUR",
          activeFrom: new Date("2026-01-01T00:00:00Z"),
          activeUntil: null,
          createdBy: "seed-admin",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    }),
  });
  const actors: Record<string, Actor> = { admin, usuaria: user };
  const handlers = createAdminHandlers({
    settings,
    pricing,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
  });
  const req = (
    path: string,
    init: { method?: string; user?: string; body?: unknown; raw?: string } = {},
  ) =>
    new Request(`http://localhost/api/admin/${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        ...(init.user ? { "x-test-user": init.user } : {}),
      },
      body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });
  const keyCtx = (key: string) => ({ params: Promise.resolve({ key }) });
  const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

  return {
    pricing,
    getSetting: (key: string, user?: string) =>
      handlers.getSetting(req(`settings/${key}`, { user }), keyCtx(key)),
    patchSetting: (key: string, body: unknown, user?: string, raw?: string) =>
      handlers.patchSetting(
        req(`settings/${key}`, { method: "PATCH", user, body, raw }),
        keyCtx(key),
      ),
    listTiers: (user?: string, query = "") =>
      handlers.listPricingTiers(req(`pricing-tiers${query}`, { user })),
    createTier: (body: unknown, user?: string) =>
      handlers.createPricingTier(req("pricing-tiers", { method: "POST", user, body })),
    patchTier: (id: string, body: unknown, user?: string) =>
      handlers.patchPricingTier(
        req(`pricing-tiers/${id}`, { method: "PATCH", user, body }),
        idCtx(id),
      ),
  };
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("REST /api/admin/settings/:key", () => {
  it("un admin cambia maxPlayersPerRoom y se lee el nuevo valor", async () => {
    const api = setup();
    const patched = await api.patchSetting("maxPlayersPerRoom", { value: 8 }, "admin");
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      key: "maxPlayersPerRoom",
      value: 8,
      updatedBy: "admin",
    });

    const read = await api.getSetting("maxPlayersPerRoom", "admin");
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(await read.json()).toMatchObject({ value: 8, isDefault: false });
  });

  it("valor inválido → 422 con detalle y sin cambios", async () => {
    const api = setup();
    for (const value of [0, 9, 6.5, "7", null]) {
      const res = await api.patchSetting("maxPlayersPerRoom", { value }, "admin");
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { code: string; issues: unknown[] } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.issues.length).toBeGreaterThan(0);
    }
    const read = await api.getSetting("maxPlayersPerRoom", "admin");
    expect(((await read.json()) as { value: number }).value).toBe(6);
  });

  it("no admin → 403 en GET y PATCH", async () => {
    const api = setup();
    const get = await api.getSetting("maxPlayersPerRoom", "usuaria");
    expect(get.status).toBe(403);
    expect(await errorCode(get)).toBe("FORBIDDEN");
    const patch = await api.patchSetting("maxPlayersPerRoom", { value: 8 }, "usuaria");
    expect(patch.status).toBe(403);
    expect(
      ((await (await api.getSetting("maxPlayersPerRoom", "admin")).json()) as { value: number })
        .value,
    ).toBe(6);
  });

  it("sin sesión → 401 (antes de validar cuerpo o clave)", async () => {
    const api = setup();
    expect((await api.getSetting("maxPlayersPerRoom")).status).toBe(401);
    expect((await api.getSetting("noExiste")).status).toBe(401);
    const res = await api.patchSetting("maxPlayersPerRoom", undefined, undefined, "{no-json");
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("clave desconocida → 404; JSON roto → 400", async () => {
    const api = setup();
    expect((await api.getSetting("noExiste", "admin")).status).toBe(404);
    const res = await api.patchSetting("maxPlayersPerRoom", undefined, "admin", "{no-json");
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("BAD_REQUEST");
  });
});

describe("REST /api/admin/pricing-tiers", () => {
  it("modificar un tramo no altera el pricingSnapshot de un evento ya creado", async () => {
    const api = setup();
    // Un evento creado antes del cambio congela los tramos como JSON.
    const eventSnapshot = JSON.parse(
      JSON.stringify(await api.pricing.snapshotAt()),
    ) as PricingSnapshot;
    const frozen = structuredClone(eventSnapshot);

    const res = await api.patchTier(TIER_ID, { priceCentsPerPlayer: 70 }, "admin");
    expect(res.status).toBe(200);
    const { closed, created } = (await res.json()) as { closed: TierJson; created: TierJson };
    expect(closed).toMatchObject({ id: TIER_ID, priceCentsPerPlayer: 75, status: "closed" });
    expect(created).toMatchObject({ priceCentsPerPlayer: 70, status: "active", activeUntil: null });

    expect(eventSnapshot).toEqual(frozen);
    expect(quotePricing(eventSnapshot, 120)?.totalCents).toBe(9000);
    expect(quotePricing(await api.pricing.snapshotAt(), 120)?.totalCents).toBe(8400);

    const list = await api.listTiers("admin");
    const { items } = (await list.json()) as { items: TierJson[] };
    expect(items.map((t) => [t.priceCentsPerPlayer, t.status])).toEqual([
      [75, "closed"],
      [70, "active"],
    ]);
    const closedOnly = await api.listTiers("admin", "?status=closed");
    expect(((await closedOnly.json()) as { items: TierJson[] }).items).toHaveLength(1);

    // El tramo histórico ya no se puede tocar.
    expect((await api.patchTier(TIER_ID, { priceCentsPerPlayer: 1 }, "admin")).status).toBe(409);
  });

  it("POST crea un tramo (201); solape → 409; inválido → 422", async () => {
    const api = setup();
    const created = await api.createTier({ minPlayers: 151, priceCentsPerPlayer: 60 }, "admin");
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      minPlayers: 151,
      maxPlayers: null,
      currency: "EUR",
    });

    expect(
      (await api.createTier({ minPlayers: 100, maxPlayers: 200, priceCentsPerPlayer: 1 }, "admin"))
        .status,
    ).toBe(409);
    expect((await api.createTier({ minPlayers: 1, priceCentsPerPlayer: -5 }, "admin")).status).toBe(
      422,
    );
    expect((await api.listTiers("admin", "?status=bogus")).status).toBe(422);
  });

  it("no admin → 403; sin sesión → 401; tramo inexistente → 404", async () => {
    const api = setup();
    expect((await api.listTiers("usuaria")).status).toBe(403);
    expect(
      (await api.createTier({ minPlayers: 151, priceCentsPerPlayer: 60 }, "usuaria")).status,
    ).toBe(403);
    expect((await api.patchTier(TIER_ID, { priceCentsPerPlayer: 1 }, "usuaria")).status).toBe(403);
    expect((await api.listTiers()).status).toBe(401);
    expect((await api.createTier({})).status).toBe(401);
    expect((await api.patchTier(TIER_ID, { priceCentsPerPlayer: 1 })).status).toBe(401);
    expect(
      (
        await api.patchTier(
          "99999999-9999-4999-8999-999999999999",
          { priceCentsPerPlayer: 1 },
          "admin",
        )
      ).status,
    ).toBe(404);
  });
});
