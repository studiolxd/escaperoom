// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeActionRateLimit: vi.fn(),
  getInvitationService: vi.fn(),
}));

vi.mock("@/server/actions/action-result", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeActionRateLimit: mocks.consumeActionRateLimit,
}));
vi.mock("@/server/services", () => ({ getInvitationService: mocks.getInvitationService }));

describe("confirmAttendance (server action)", () => {
  beforeEach(() => {
    mocks.consumeActionRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
    mocks.getInvitationService.mockReset();
  });

  it("confirma la asistencia y devuelve el resultado del servicio", async () => {
    const confirm = vi.fn().mockResolvedValue({
      status: "confirmed",
      alreadyConfirmed: false,
      eventTitle: "El Rey Aldric",
    });
    mocks.getInvitationService.mockReturnValue({ confirm });
    const { confirmAttendance } = await import("@/actions/attendance");

    const result = await confirmAttendance({ code: "ABC123", token: "tok" });

    expect(result).toEqual({
      ok: true,
      data: { status: "confirmed", alreadyConfirmed: false, eventTitle: "El Rey Aldric" },
    });
    expect(confirm).toHaveBeenCalledWith("ABC123", { token: "tok" });
  });

  it("traduce `AccessKeyError` (p. ej. CONFIRMATION_EXPIRED) al contrato de error", async () => {
    const { AccessKeyError } = await import("@escaperoom/shared/services");
    const confirm = vi
      .fn()
      .mockRejectedValue(new AccessKeyError("CONFIRMATION_EXPIRED", "El enlace ha caducado"));
    mocks.getInvitationService.mockReturnValue({ confirm });
    const { confirmAttendance } = await import("@/actions/attendance");

    const result = await confirmAttendance({ code: "ABC123", token: "tok" });

    expect(result).toEqual({
      ok: false,
      error: { code: "CONFIRMATION_EXPIRED", message: "El enlace ha caducado" },
    });
  });

  it("respeta el rate limit `invitation-confirm`: RATE_LIMITED sin llamar al servicio", async () => {
    mocks.consumeActionRateLimit.mockResolvedValue({ ok: false, retryAfter: 10 });
    const confirm = vi.fn();
    mocks.getInvitationService.mockReturnValue({ confirm });
    const { confirmAttendance } = await import("@/actions/attendance");

    const result = await confirmAttendance({ code: "ABC123", token: "tok" });

    expect(result).toEqual({ ok: false, error: { code: "RATE_LIMITED", message: expect.any(String) } });
    expect(mocks.consumeActionRateLimit).toHaveBeenCalledWith("invitation-confirm");
    expect(confirm).not.toHaveBeenCalled();
  });
});
