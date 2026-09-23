import {
  ANONYMOUS_ACTOR,
  createInMemoryTermsAcceptanceStore,
  createTermsAcceptanceService,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createLegalAcceptanceHandlers } from "../src/server/rest/legal-acceptance";

const USER: Actor = { userId: "user-1", organizationId: null, role: "member" };

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/legal/terms-acceptance", { method, headers });
}

describe("GET/POST /api/legal/terms-acceptance", () => {
  it("GET responde 401 sin sesión", async () => {
    const store = createInMemoryTermsAcceptanceStore();
    const handlers = createLegalAcceptanceHandlers({
      termsAcceptance: createTermsAcceptanceService({ store }),
      resolveActor: async () => ANONYMOUS_ACTOR,
    });

    const response = await handlers.getStatus(request("GET"));

    expect(response.status).toBe(401);
  });

  it("GET responde needsAcceptance:true si el usuario nunca aceptó", async () => {
    const store = createInMemoryTermsAcceptanceStore();
    const handlers = createLegalAcceptanceHandlers({
      termsAcceptance: createTermsAcceptanceService({ store }),
      resolveActor: async () => USER,
    });

    const response = await handlers.getStatus(request("GET"));

    expect(response.status).toBe(200);
    const json = (await response.json()) as { needsAcceptance: boolean; version: string };
    expect(json.needsAcceptance).toBe(true);
  });

  it("POST responde 401 sin sesión y no registra nada", async () => {
    const store = createInMemoryTermsAcceptanceStore();
    const handlers = createLegalAcceptanceHandlers({
      termsAcceptance: createTermsAcceptanceService({ store }),
      resolveActor: async () => ANONYMOUS_ACTOR,
    });

    const response = await handlers.accept(request("POST"));

    expect(response.status).toBe(401);
    expect(store.rows).toHaveLength(0);
  });

  it("POST registra la aceptación y GET deja de exigirla", async () => {
    const store = createInMemoryTermsAcceptanceStore();
    const service = createTermsAcceptanceService({ store });
    const handlers = createLegalAcceptanceHandlers({
      termsAcceptance: service,
      resolveActor: async () => USER,
    });

    const acceptResponse = await handlers.accept(
      request("POST", { "x-forwarded-for": "1.2.3.4", "user-agent": "vitest" }),
    );
    expect(acceptResponse.status).toBe(200);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      userId: "user-1",
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
    });

    const statusResponse = await handlers.getStatus(request("GET"));
    const json = (await statusResponse.json()) as { needsAcceptance: boolean };
    expect(json.needsAcceptance).toBe(false);
  });
});
