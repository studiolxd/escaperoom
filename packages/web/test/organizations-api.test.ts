import {
  AccessKeyError,
  ANONYMOUS_ACTOR,
  CURRENT_DPA_VERSION,
  createAccessKeyService,
  createEventService,
  createFakePaymentGateway,
  createInMemoryAccessKeyStore,
  createInMemoryEventStore,
  createInMemoryOrganizationStore,
  createInMemoryPricingTierStore,
  createOrganizationService,
  createPricingTierService,
  type Actor,
  type PricingTierRow,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createAccessKeyHandlers } from "../src/server/rest/access-keys";
import { createOrganizationHandlers } from "../src/server/rest/organizations";

const ORG = "org-colegio";
const owner: Actor = { userId: "autora", organizationId: ORG, role: "member" };
const member: Actor = { userId: "profe", organizationId: ORG, role: "member" };

const VERSION = "10000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-06-01T10:00:00Z");

type ErrorJson = { error: { code: string; message: string } };

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
  const now = () => NOW;
  const orgStore = createInMemoryOrganizationStore({
    organizations: [{ id: ORG }],
    members: [
      { organizationId: ORG, userId: owner.userId, role: "owner" },
      { organizationId: ORG, userId: member.userId, role: "member" },
    ],
  });
  const organizations = createOrganizationService({ store: orgStore, now });
  const eventStore = createInMemoryEventStore({
    roomVersions: [
      {
        roomVersionId: VERSION,
        roomId: "20000000-0000-4000-8000-000000000001",
        authorId: owner.userId,
        roomStatus: "published",
        saleEvents: true,
      },
    ],
  });
  const events = createEventService({
    store: eventStore,
    pricing: createPricingTierService({
      store: createInMemoryPricingTierStore({ adminIds: [], tiers: [tier] }),
      now,
    }),
    payments: createFakePaymentGateway(),
    now,
  });
  const accessKeys = createAccessKeyService({
    store: createInMemoryAccessKeyStore({ events: eventStore }),
    events,
    dpa: organizations.dpaGate((message) => new AccessKeyError("DPA_REQUIRED", message)),
    now,
  });
  const actors: Record<string, Actor> = { autora: owner, profe: member };
  const resolveActor = async (req: Request) =>
    actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR;
  const orgHandlers = createOrganizationHandlers({ organizations, resolveActor });
  const keyHandlers = createAccessKeyHandlers({ accessKeys, resolveActor });

  const post = (path: string, user: string | undefined, body: unknown, raw?: string) =>
    new Request(`http://localhost/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: raw ?? JSON.stringify(body),
    });
  const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

  return {
    orgStore,
    sign: (user: string | undefined, body: unknown, raw?: string, orgId = ORG) =>
      orgHandlers.postSignDpa(
        post(`organizations/${orgId}/dpa/sign`, user, body, raw),
        idCtx(orgId),
      ),
    async activeEvent() {
      const event = await events.createEvent(owner, {
        roomVersionId: VERSION,
        title: "Jornada",
        maxSimultaneousSessions: 1,
        groupingMode: "random",
        requireConfirmation: false,
        expiryRules: [],
        playersPlanned: 20,
      });
      await accessKeys.activateEvent(owner, event.id, { keyPlan: [{ type: "batch", count: 1 }] });
      return event;
    },
    generate: (eventId: string, body: unknown) =>
      keyHandlers.postAccessKeys(
        post(`events/${eventId}/access-keys`, "autora", body),
        idCtx(eventId),
      ),
  };
}

describe("POST /api/organizations/:id/dpa/sign", () => {
  it("200: el propietario firma; se registran versión, firmante y fecha", async () => {
    const t = setup();
    const res = await t.sign("autora", { version: CURRENT_DPA_VERSION });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      organizationId: ORG,
      currentVersion: CURRENT_DPA_VERSION,
      signed: true,
      version: CURRENT_DPA_VERSION,
      signedBy: owner.userId,
      signedAt: NOW.toISOString(),
      alreadySigned: false,
    });
  });

  it("403 a un miembro sin rol; 401 sin sesión; 404 organización ajena", async () => {
    const t = setup();
    const body = { version: CURRENT_DPA_VERSION };
    const forbidden = await t.sign("profe", body);
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as ErrorJson).error.code).toBe("FORBIDDEN");
    expect((await t.sign(undefined, body)).status).toBe(401);
    expect((await t.sign("autora", body, undefined, "otra-org")).status).toBe(404);
    expect(t.orgStore.organizations[0]!.dpaSignedAt).toBeNull();
  });

  it("409 con una versión que no es la vigente; 422 sin versión; 400 con JSON roto", async () => {
    const t = setup();
    const mismatch = await t.sign("autora", { version: "2020-01-01" });
    expect(mismatch.status).toBe(409);
    expect(((await mismatch.json()) as ErrorJson).error.code).toBe("DPA_VERSION_MISMATCH");
    expect((await t.sign("autora", {})).status).toBe(422);
    expect((await t.sign("autora", undefined, "{no")).status).toBe(400);
  });
});

describe("DPA_REQUIRED en POST /api/events/:id/access-keys", () => {
  it("403 DPA_REQUIRED con emails sin DPA; group/batch 201; tras firmar, emails 201", async () => {
    const t = setup();
    const event = await t.activeEvent();
    const withEmails = { type: "individual", emails: ["alumno1@colegio.example.com"] };

    const blocked = await t.generate(event.id, withEmails);
    expect(blocked.status).toBe(403);
    const err = (await blocked.json()) as ErrorJson;
    expect(err.error.code).toBe("DPA_REQUIRED");
    expect(err.error.message).toMatch(/DPA/);

    expect((await t.generate(event.id, { type: "group", count: 1, seats: 4 })).status).toBe(201);
    expect((await t.generate(event.id, { type: "batch", count: 5 })).status).toBe(201);

    expect((await t.sign("autora", { version: CURRENT_DPA_VERSION })).status).toBe(200);
    const allowed = await t.generate(event.id, withEmails);
    expect(allowed.status).toBe(201);
    const json = (await allowed.json()) as { items: Array<{ email: string | null }> };
    expect(json.items.map((k) => k.email)).toEqual(["alumno1@colegio.example.com"]);
  });
});
