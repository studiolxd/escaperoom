// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  resolveActorFromHeaders: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.5" }),
}));
vi.mock("@/server/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock("@/server/context", () => ({ resolveActorFromHeaders: mocks.resolveActorFromHeaders }));

describe("consumeActionRateLimit (rate limiting para Server Actions, A-22 equivalente)", () => {
  beforeEach(() => {
    mocks.consumeRateLimit.mockReset();
    mocks.resolveActorFromHeaders.mockReset().mockResolvedValue({ role: "anonymous" });
  });

  it("gasta la cuota de la policy indicada reconstruyendo la petición a partir de `headers()`", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ ok: true, retryAfter: 0 });
    const { consumeActionRateLimit } = await import("@/server/actions/action-result");

    const result = await consumeActionRateLimit("contact-write");

    expect(result).toEqual({ ok: true, retryAfter: 0 });
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      "contact-write",
      expect.objectContaining({ headers: expect.any(Headers) }),
      expect.objectContaining({ resolveUserId: expect.any(Function) }),
    );
  });

  it("la cuota por usuario resuelve el actor de la sesión (`resolveActorFromHeaders`), no un `Request`", async () => {
    mocks.consumeRateLimit.mockImplementation(async (_policy, _req, deps) => {
      const userId = await deps.resolveUserId();
      return userId === "blocked-user"
        ? { ok: false, retryAfter: 30 }
        : { ok: true, retryAfter: 0 };
    });
    mocks.resolveActorFromHeaders.mockResolvedValue({ role: "user", userId: "blocked-user" });
    const { consumeActionRateLimit } = await import("@/server/actions/action-result");

    const result = await consumeActionRateLimit("review-write");

    expect(result).toEqual({ ok: false, retryAfter: 30 });
  });
});

describe("actionOk / actionError", () => {
  it("actionOk envuelve el dato en { ok: true }", async () => {
    const { actionOk } = await import("@/server/actions/action-result");
    expect(actionOk({ x: 1 })).toEqual({ ok: true, data: { x: 1 } });
  });

  it("actionError solo incluye `issues` cuando hay alguno", async () => {
    const { actionError } = await import("@/server/actions/action-result");
    expect(actionError("VALIDATION_ERROR", "mal")).toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "mal" },
    });
    expect(actionError("VALIDATION_ERROR", "mal", [{ path: "email", message: "no válido" }])).toEqual(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "mal",
          issues: [{ path: "email", message: "no válido" }],
        },
      },
    );
  });
});
