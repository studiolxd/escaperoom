import { describe, expect, it } from "vitest";
import { toMeResponse, type MeUser } from "../src/lib/me";

const baseUser: MeUser = {
  id: "u1",
  email: "a@b.c",
  name: "Ana",
  image: null,
  locale: "es",
  isAdmin: false,
  isModerator: false,
  creditAccount: [
    { userId: "u1", balanceCredits: 4200n },
    { userId: null, balanceCredits: 10n },
  ],
  member: [{ role: "owner", organization: { id: "o1", name: "Org", slug: "org" } }],
};

describe("toMeResponse", () => {
  it("picks the personal credit account, not the organization one", () => {
    expect(toMeResponse(baseUser).personalCredits).toBe(4200);
  });

  it("maps organizations with the member role", () => {
    expect(toMeResponse(baseUser).organizations).toEqual([
      { id: "o1", name: "Org", slug: "org", role: "owner" },
    ]);
  });

  it("defaults credits to 0 when there is no personal account", () => {
    const user: MeUser = { ...baseUser, creditAccount: [] };
    expect(toMeResponse(user).personalCredits).toBe(0);
  });
});
