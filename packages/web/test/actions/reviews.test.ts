// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeActionRateLimit: vi.fn(),
  resolveActorFromHeaders: vi.fn(),
  getReviewService: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/actions/action-result", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeActionRateLimit: mocks.consumeActionRateLimit,
}));
vi.mock("@/server/context", () => ({ resolveActorFromHeaders: mocks.resolveActorFromHeaders }));
vi.mock("@/server/services", () => ({ getReviewService: mocks.getReviewService }));

const ACTOR = { role: "user", userId: "u1" };

describe("upsertRoomReview (server action)", () => {
  beforeEach(() => {
    mocks.consumeActionRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
    mocks.resolveActorFromHeaders.mockReset().mockResolvedValue(ACTOR);
    mocks.getReviewService.mockReset();
  });

  it("crea/edita la reseña con el actor de la sesión y devuelve ok:true", async () => {
    const upsertReview = vi
      .fn()
      .mockResolvedValue({ created: true, ratingAvg: 4, ratingCount: 1 });
    mocks.getReviewService.mockReturnValue({ upsertReview });
    const { upsertRoomReview } = await import("@/actions/reviews");

    const result = await upsertRoomReview("sala-1", { rating: 4, text: "Genial" });

    expect(result).toEqual({ ok: true, data: { created: true, ratingAvg: 4, ratingCount: 1 } });
    expect(upsertReview).toHaveBeenCalledWith(ACTOR, "sala-1", { rating: 4, text: "Genial" });
  });

  it("traduce `ReviewError` (p. ej. CONTENT_REJECTED) al contrato de error de la action", async () => {
    const { ReviewError } = await import("@escaperoom/shared/services");
    const upsertReview = vi
      .fn()
      .mockRejectedValue(new ReviewError("CONTENT_REJECTED", "lenguaje no permitido"));
    mocks.getReviewService.mockReturnValue({ upsertReview });
    const { upsertRoomReview } = await import("@/actions/reviews");

    const result = await upsertRoomReview("sala-1", { rating: 3, text: "malo" });

    expect(result).toEqual({
      ok: false,
      error: { code: "CONTENT_REJECTED", message: "lenguaje no permitido" },
    });
  });

  it("respeta el rate limit `review-write`: RATE_LIMITED sin llamar al servicio", async () => {
    mocks.consumeActionRateLimit.mockResolvedValue({ ok: false, retryAfter: 60 });
    const upsertReview = vi.fn();
    mocks.getReviewService.mockReturnValue({ upsertReview });
    const { upsertRoomReview } = await import("@/actions/reviews");

    const result = await upsertRoomReview("sala-1", { rating: 4, text: "" });

    expect(result).toEqual({ ok: false, error: { code: "RATE_LIMITED", message: expect.any(String) } });
    expect(mocks.consumeActionRateLimit).toHaveBeenCalledWith("review-write");
    expect(upsertReview).not.toHaveBeenCalled();
  });
});
