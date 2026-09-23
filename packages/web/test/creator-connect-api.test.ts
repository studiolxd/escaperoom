import {
  ANONYMOUS_ACTOR,
  createCreatorConnectService,
  createFakeConnectGateway,
  createInMemoryCreatorConnectStore,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createCreatorConnectHandlers } from "../src/server/rest/creator-connect";

const creator: Actor = { userId: "creadora", organizationId: null, role: "member" };

function setup() {
  const store = createInMemoryCreatorConnectStore([
    { id: creator.userId, email: "creadora@example.test" },
  ]);
  const connect = createCreatorConnectService({ store, connect: createFakeConnectGateway() });
  const actors: Record<string, Actor> = { creadora: creator };
  const handlers = createCreatorConnectHandlers({
    connect,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
    buildUrls: () => ({ refreshUrl: "https://app.test/refresh", returnUrl: "https://app.test/return" }),
  });
  const post = (user?: string) =>
    handlers.postStripeConnect(
      new Request("http://localhost/api/me/stripe-connect", {
        method: "POST",
        headers: user ? { "x-test-user": user } : {},
      }),
    );
  const status = (user?: string) =>
    handlers.getStripeConnectStatus(
      new Request("http://localhost/api/me/stripe-connect/status", {
        headers: user ? { "x-test-user": user } : {},
      }),
    );
  return { post, status };
}

describe("POST /api/me/stripe-connect", () => {
  it("401 sin sesión", async () => {
    const { post } = setup();
    expect((await post()).status).toBe(401);
  });

  it("200 con la URL de onboarding", async () => {
    const { post } = setup();
    const res = await post("creadora");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain("connect.example.test/onboarding/");
  });
});

describe("GET /api/me/stripe-connect/status", () => {
  it("not_started sin onboarding iniciado, pending después", async () => {
    const { post, status } = setup();
    expect((await (await status("creadora")).json()) as { status: string }).toEqual({
      status: "not_started",
    });
    await post("creadora");
    expect((await (await status("creadora")).json()) as { status: string }).toEqual({
      status: "pending",
    });
  });
});
