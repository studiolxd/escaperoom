// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeActionRateLimit: vi.fn(),
  resolveActorFromHeaders: vi.fn(),
  getRedeemService: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/actions/action-result", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeActionRateLimit: mocks.consumeActionRateLimit,
}));
vi.mock("@/server/context", () => ({ resolveActorFromHeaders: mocks.resolveActorFromHeaders }));
vi.mock("@/server/services", () => ({ getRedeemService: mocks.getRedeemService }));

const ACTOR = { role: "anonymous" };

describe("redeemAccessKey (server action)", () => {
  beforeEach(() => {
    mocks.consumeActionRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
    mocks.resolveActorFromHeaders.mockReset().mockResolvedValue(ACTOR);
    mocks.getRedeemService.mockReset();
  });

  it("canjea la clave y devuelve sessionId + joinToken", async () => {
    const redeem = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      joinToken: "token-abc",
      eventId: "event-1",
      groupId: null,
      colyseusEndpoint: "ws://localhost:2567",
      roomName: "game",
      expiresAt: new Date(),
      player: { id: "guest:1", displayName: "Invitado", guest: true },
    });
    mocks.getRedeemService.mockReturnValue({ redeem });
    const { redeemAccessKey } = await import("@/actions/redeem");

    const result = await redeemAccessKey({ code: "ABC123" });

    expect(result).toEqual({
      ok: true,
      data: { sessionId: "session-1", joinToken: "token-abc" },
    });
    expect(redeem).toHaveBeenCalledWith(ACTOR, { code: "ABC123" });
  });

  it("traduce `AccessKeyError` (p. ej. ACCESS_KEY_INVALID) al contrato de error de la action", async () => {
    const { AccessKeyError } = await import("@escaperoom/shared/services");
    const redeem = vi.fn().mockRejectedValue(new AccessKeyError("ACCESS_KEY_INVALID", "Clave no válida"));
    mocks.getRedeemService.mockReturnValue({ redeem });
    const { redeemAccessKey } = await import("@/actions/redeem");

    const result = await redeemAccessKey({ code: "NOPE" });

    expect(result).toEqual({
      ok: false,
      error: { code: "ACCESS_KEY_INVALID", message: "Clave no válida" },
    });
  });

  it("devuelve REDEEM_UNAVAILABLE cuando el servicio no está configurado", async () => {
    mocks.getRedeemService.mockReturnValue(null);
    const { redeemAccessKey } = await import("@/actions/redeem");

    const result = await redeemAccessKey({ code: "ABC123" });

    expect(result).toEqual({
      ok: false,
      error: { code: "REDEEM_UNAVAILABLE", message: expect.any(String) },
    });
  });

  it("respeta el rate limit `redeem`: RATE_LIMITED sin llamar al servicio", async () => {
    mocks.consumeActionRateLimit.mockResolvedValue({ ok: false, retryAfter: 15 });
    const redeem = vi.fn();
    mocks.getRedeemService.mockReturnValue({ redeem });
    const { redeemAccessKey } = await import("@/actions/redeem");

    const result = await redeemAccessKey({ code: "ABC123" });

    expect(result).toEqual({ ok: false, error: { code: "RATE_LIMITED", message: expect.any(String) } });
    expect(mocks.consumeActionRateLimit).toHaveBeenCalledWith("redeem");
    expect(redeem).not.toHaveBeenCalled();
  });
});
