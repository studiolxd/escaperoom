// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveActorFromHeaders: vi.fn(),
  getEventService: vi.fn(),
  getInvitationService: vi.fn(),
  consumeActionRateLimit: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/context", () => ({ resolveActorFromHeaders: mocks.resolveActorFromHeaders }));
vi.mock("@/server/services", () => ({
  getEventService: mocks.getEventService,
  getInvitationService: mocks.getInvitationService,
}));
vi.mock("@/server/actions/action-result", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeActionRateLimit: mocks.consumeActionRateLimit,
}));

const ACTOR = { role: "user", userId: "u1" };

describe("createMinimalEvent (server action)", () => {
  beforeEach(() => {
    mocks.resolveActorFromHeaders.mockReset().mockResolvedValue(ACTOR);
    mocks.getEventService.mockReset();
  });

  it("crea el evento con los valores por defecto del flujo mínimo y devuelve su id", async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: "event-1" });
    mocks.getEventService.mockReturnValue({ createEvent });
    const { createMinimalEvent } = await import("@/actions/events");

    const result = await createMinimalEvent({
      roomVersionId: "11111111-1111-1111-1111-111111111111",
      title: "Cumpleaños",
      playersPlanned: 12,
    });

    expect(result).toEqual({ ok: true, data: { id: "event-1" } });
    expect(createEvent).toHaveBeenCalledWith(ACTOR, {
      roomVersionId: "11111111-1111-1111-1111-111111111111",
      title: "Cumpleaños",
      playersPlanned: 12,
      maxSimultaneousSessions: 1,
      groupingMode: "free",
      requireConfirmation: false,
      expiryRules: [],
      audience: "general",
    });
  });

  it("traduce `EventError` (p. ej. SALE_EVENTS_DISABLED) al contrato de error de la action", async () => {
    const { EventError } = await import("@escaperoom/shared/services");
    const createEvent = vi
      .fn()
      .mockRejectedValue(new EventError("SALE_EVENTS_DISABLED", "La sala no está a la venta para eventos"));
    mocks.getEventService.mockReturnValue({ createEvent });
    const { createMinimalEvent } = await import("@/actions/events");

    const result = await createMinimalEvent({
      roomVersionId: "11111111-1111-1111-1111-111111111111",
      title: "Cumpleaños",
      playersPlanned: 12,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "SALE_EVENTS_DISABLED", message: "La sala no está a la venta para eventos" },
    });
  });
});

describe("resendPendingInvitations (server action)", () => {
  beforeEach(() => {
    mocks.resolveActorFromHeaders.mockReset().mockResolvedValue(ACTOR);
    mocks.getInvitationService.mockReset();
    mocks.consumeActionRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
  });

  it("reenvía a los pendientes de confirmar y devuelve el recuento", async () => {
    const resendPending = vi.fn().mockResolvedValue({ requested: 5, queued: 5 });
    mocks.getInvitationService.mockReturnValue({ resendPending });
    const { resendPendingInvitations } = await import("@/actions/events");

    const result = await resendPendingInvitations("event-1");

    expect(result).toEqual({ ok: true, data: { requested: 5, queued: 5 } });
    expect(resendPending).toHaveBeenCalledWith(ACTOR, "event-1");
  });

  it("traduce `AccessKeyError` (p. ej. EVENT_NOT_ACTIVE) al contrato de error", async () => {
    const { AccessKeyError } = await import("@escaperoom/shared/services");
    const resendPending = vi
      .fn()
      .mockRejectedValue(new AccessKeyError("EVENT_NOT_ACTIVE", "El evento no está activo"));
    mocks.getInvitationService.mockReturnValue({ resendPending });
    const { resendPendingInvitations } = await import("@/actions/events");

    const result = await resendPendingInvitations("event-1");

    expect(result).toEqual({
      ok: false,
      error: { code: "EVENT_NOT_ACTIVE", message: "El evento no está activo" },
    });
  });

  it("respeta el rate limit `invitation-resend-pending`: RATE_LIMITED sin llamar al servicio", async () => {
    mocks.consumeActionRateLimit.mockResolvedValue({ ok: false, retryAfter: 30 });
    const resendPending = vi.fn();
    mocks.getInvitationService.mockReturnValue({ resendPending });
    const { resendPendingInvitations } = await import("@/actions/events");

    const result = await resendPendingInvitations("event-1");

    expect(result).toEqual({ ok: false, error: { code: "RATE_LIMITED", message: expect.any(String) } });
    expect(mocks.consumeActionRateLimit).toHaveBeenCalledWith("invitation-resend-pending");
    expect(resendPending).not.toHaveBeenCalled();
  });
});
