// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveActorFromHeaders: vi.fn(),
  getEventService: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/context", () => ({ resolveActorFromHeaders: mocks.resolveActorFromHeaders }));
vi.mock("@/server/services", () => ({ getEventService: mocks.getEventService }));

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
