// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  createUserDataRightsService,
  type Actor,
  type UserDataExportBundle,
  type UserDataRightsStore,
  type UserProfileRow,
} from "../src/services";

const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-09-01T10:00:00Z");

const actor: Actor = { userId: "user-1", organizationId: null, role: "member" };

const profile: UserProfileRow = {
  id: "user-1",
  email: "creadora@example.com",
  name: "Creadora",
  image: null,
  locale: "es",
  isAdmin: false,
  isModerator: false,
  createdAt: T0,
};

const bundle: Omit<UserDataExportBundle, "profile"> = {
  organizations: [{ organizationId: "org-1", name: "Colegio X", slug: "colegio-x", role: "owner" }],
  personalCreditsBalance: 42,
  roomsAuthored: [
    { id: "room-1", title: "Sala 1", status: "published", createdAt: T0, updatedAt: T0 },
  ],
  purchases: [
    {
      id: "purchase-1",
      purchaseType: "single_play",
      amountCents: 500,
      currency: "EUR",
      status: "completed",
      createdAt: T0,
      roomTitle: "Sala comprada",
      eventTitle: null,
    },
  ],
  eventsOrganized: [
    { id: "event-1", title: "Evento 1", status: "active", audience: "general", createdAt: T0 },
  ],
  reviews: [{ roomId: "room-2", rating: 5, text: "Genial", createdAt: T0, updatedAt: T0, hidden: false }],
  moderationStrikesReceived: [],
  moderationAppealsFiled: [],
  contentReportsFiled: [],
};

function createFakeStore(opts: { profile?: UserProfileRow | null } = {}) {
  const users = new Map<string, UserProfileRow>();
  if (opts.profile !== null) users.set(profile.id, { ...(opts.profile ?? profile) });
  const anonymized: { userId: string; at: Date }[] = [];

  const store: UserDataRightsStore = {
    async findProfile(userId) {
      return users.get(userId) ?? null;
    },
    async loadExportBundle() {
      return bundle;
    },
    async anonymizeAccount(userId, at) {
      anonymized.push({ userId, at });
      const u = users.get(userId);
      if (u) users.set(userId, { ...u, email: `deleted-${userId}@deleted.invalid`, name: "Usuario eliminado" });
    },
  };

  return { store, users, anonymized };
}

async function rejects(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `se esperaba ${code}`).toBeInstanceOf(Error);
  expect((err as { code?: string }).code).toBe(code);
}

describe("export de datos (GET /api/me/data-export)", () => {
  it("exporta el perfil y el resto del bundle en JSON con fechas ISO", async () => {
    const { store } = createFakeStore();
    const service = createUserDataRightsService({ store, now: () => NOW });
    const json = await service.exportData(actor);
    expect(json.exportedAt).toBe(NOW.toISOString());
    expect(json.profile).toMatchObject({ id: "user-1", email: profile.email });
    expect(json.profile.createdAt).toBe(T0.toISOString());
    expect(json.organizations).toEqual(bundle.organizations);
    expect(json.personalCreditsBalance).toBe(42);
    expect(json.roomsAuthored[0]).toMatchObject({ id: "room-1", createdAt: T0.toISOString() });
    expect(json.purchases[0]).toMatchObject({ id: "purchase-1", roomTitle: "Sala comprada" });
    expect(json.reviews[0]).toMatchObject({ roomId: "room-2", hidden: false });
  });

  it("actor anónimo → UNAUTHORIZED", async () => {
    const { store } = createFakeStore();
    const service = createUserDataRightsService({ store });
    await rejects(service.exportData(ANONYMOUS_ACTOR), "UNAUTHORIZED");
  });

  it("perfil inexistente → NOT_FOUND", async () => {
    const { store } = createFakeStore({ profile: null });
    const service = createUserDataRightsService({ store });
    await rejects(service.exportData(actor), "NOT_FOUND");
  });
});

describe("cierre de cuenta (DELETE /api/me)", () => {
  it("anonimiza el perfil y devuelve deletedAt", async () => {
    const { store, users, anonymized } = createFakeStore();
    const service = createUserDataRightsService({ store, now: () => NOW });
    const result = await service.deleteAccount(actor);
    expect(result.deletedAt).toEqual(NOW);
    expect(anonymized).toEqual([{ userId: "user-1", at: NOW }]);
    expect(users.get("user-1")?.name).toBe("Usuario eliminado");
  });

  it("actor anónimo → UNAUTHORIZED; sin perfil → NOT_FOUND", async () => {
    const { store } = createFakeStore();
    const service = createUserDataRightsService({ store });
    await rejects(service.deleteAccount(ANONYMOUS_ACTOR), "UNAUTHORIZED");

    const missing = createFakeStore({ profile: null });
    const service2 = createUserDataRightsService({ store: missing.store });
    await rejects(service2.deleteAccount(actor), "NOT_FOUND");
  });
});
