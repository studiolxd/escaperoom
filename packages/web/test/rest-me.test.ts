import { ANONYMOUS_ACTOR, createMeService, type Actor, type MeStore } from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createMeHandlers } from "@/server/rest/me";

const author: Actor = { userId: "u1", organizationId: null, role: "member" };

function handlersFor(resolveActor: (r: Request) => Promise<Actor>) {
  const store: MeStore = {
    async findProfile(userId) {
      if (userId !== "u1") return null;
      return {
        id: "u1",
        email: "a@b.c",
        name: "Ana",
        image: null,
        locale: "es",
        isAdmin: false,
        isModerator: false,
        personalBalanceCredits: 100n,
        organizations: [],
      };
    },
  };
  return createMeHandlers({ me: createMeService({ store }), resolveActor });
}

describe("server/rest/me (A-24)", () => {
  it("sin sesión: 401 UNAUTHORIZED, no-store", async () => {
    const handlers = handlersFor(async () => ANONYMOUS_ACTOR);
    const res = await handlers.getMe(new Request("http://localhost/api/me"));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("con sesión: 200 con el perfil, no-store", async () => {
    const handlers = handlersFor(async () => author);
    const res = await handlers.getMe(new Request("http://localhost/api/me"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).user.id).toBe("u1");
  });
});
