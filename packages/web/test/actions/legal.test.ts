// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeActionRateLimit: vi.fn(),
  resolveActorFromHeaders: vi.fn(),
  getTermsAcceptanceService: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("@/server/actions/action-result", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeActionRateLimit: mocks.consumeActionRateLimit,
}));
vi.mock("@/server/context", () => ({ resolveActorFromHeaders: mocks.resolveActorFromHeaders }));
vi.mock("@/server/services", () => ({ getTermsAcceptanceService: mocks.getTermsAcceptanceService }));

describe("acceptTerms (server action)", () => {
  beforeEach(() => {
    mocks.consumeActionRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
    mocks.resolveActorFromHeaders.mockReset();
    mocks.getTermsAcceptanceService.mockReset();
  });

  it("registra la aceptación de un usuario con sesión", async () => {
    mocks.resolveActorFromHeaders.mockResolvedValue({
      userId: "u1",
      organizationId: null,
      role: "member",
    });
    const accept = vi.fn().mockResolvedValue({ userId: "u1", version: "2026-01" });
    mocks.getTermsAcceptanceService.mockReturnValue({ accept });
    const { acceptTerms } = await import("@/actions/legal");

    const result = await acceptTerms();

    expect(result).toEqual({ ok: true, data: { version: "2026-01" } });
    expect(accept).toHaveBeenCalledWith("u1", { ipAddress: null, userAgent: "vitest" });
  });

  it("devuelve UNAUTHORIZED sin sesión, sin llamar al servicio", async () => {
    mocks.resolveActorFromHeaders.mockResolvedValue({
      userId: "anon",
      organizationId: null,
      role: "anonymous",
    });
    const accept = vi.fn();
    mocks.getTermsAcceptanceService.mockReturnValue({ accept });
    const { acceptTerms } = await import("@/actions/legal");

    const result = await acceptTerms();

    expect(result).toEqual({ ok: false, error: { code: "UNAUTHORIZED", message: expect.any(String) } });
    expect(accept).not.toHaveBeenCalled();
  });

  it("respeta el rate limit `terms-acceptance-write`: RATE_LIMITED sin resolver el actor", async () => {
    mocks.consumeActionRateLimit.mockResolvedValue({ ok: false, retryAfter: 5 });
    const { acceptTerms } = await import("@/actions/legal");

    const result = await acceptTerms();

    expect(result).toEqual({ ok: false, error: { code: "RATE_LIMITED", message: expect.any(String) } });
    expect(mocks.consumeActionRateLimit).toHaveBeenCalledWith("terms-acceptance-write");
    expect(mocks.resolveActorFromHeaders).not.toHaveBeenCalled();
  });
});
