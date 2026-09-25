import { describe, expect, it } from "vitest";
import { ANONYMOUS_ACTOR, createMeService, type Actor, type MeProfileRow, type MeStore } from "../src/services";

const author: Actor = { userId: "u1", organizationId: null, role: "member" };

const ROW: MeProfileRow = {
  id: "u1",
  email: "a@b.c",
  name: "Ana",
  image: null,
  locale: "es",
  isAdmin: false,
  isModerator: false,
  personalBalanceCredits: 4200n,
  organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
};

function fakeStore(rows: Record<string, MeProfileRow>): MeStore {
  return { async findProfile(userId) { return rows[userId] ?? null; } };
}

describe("me (A-24: GET /api/me vía servicio, select acotado)", () => {
  it("exige sesión", async () => {
    const service = createMeService({ store: fakeStore({}) });
    await expect(service.getProfile(ANONYMOUS_ACTOR)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("NOT_FOUND si el usuario no existe", async () => {
    const service = createMeService({ store: fakeStore({}) });
    await expect(service.getProfile(author)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("mapea el perfil, el crédito personal y las organizaciones", async () => {
    const service = createMeService({ store: fakeStore({ u1: ROW }) });
    const profile = await service.getProfile(author);
    expect(profile).toEqual({
      user: {
        id: "u1",
        email: "a@b.c",
        name: "Ana",
        image: null,
        locale: "es",
        isAdmin: false,
        isModerator: false,
      },
      personalCredits: 4200,
      organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
    });
  });

  it("crédito 0 sin cuenta personal", async () => {
    const service = createMeService({
      store: fakeStore({ u1: { ...ROW, personalBalanceCredits: 0n } }),
    });
    expect((await service.getProfile(author)).personalCredits).toBe(0);
  });
});
