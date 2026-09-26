// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveActorFromHeaders: vi.fn(),
  getModerationService: vi.fn(),
  getAudioAssetService: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/context", () => ({ resolveActorFromHeaders: mocks.resolveActorFromHeaders }));
vi.mock("@/server/services", () => ({
  getModerationService: mocks.getModerationService,
  getAudioAssetService: mocks.getAudioAssetService,
}));

const MODERATOR = { userId: "mod-1", organizationId: null, role: "admin" as const };

describe("acciones de moderación (server actions)", () => {
  beforeEach(() => {
    mocks.resolveActorFromHeaders.mockReset().mockResolvedValue(MODERATOR);
    mocks.getModerationService.mockReset();
    mocks.getAudioAssetService.mockReset();
  });

  describe("resolveModerationReport", () => {
    it("resuelve el reporte con el mismo ModerationService.resolveReport", async () => {
      const resolveReport = vi.fn().mockResolvedValue({
        report: { id: "r1", status: "actioned" },
        strike: null,
        standing: null,
      });
      mocks.getModerationService.mockReturnValue({ resolveReport });
      const { resolveModerationReport } = await import("@/actions/moderation");

      const result = await resolveModerationReport({
        id: "r1",
        status: "actioned",
        resolutionNote: "confirmado",
      });

      expect(result.ok).toBe(true);
      expect(resolveReport).toHaveBeenCalledWith(MODERATOR, "r1", {
        status: "actioned",
        resolutionNote: "confirmado",
      });
    });

    it("traduce `ModerationError` (p. ej. ALREADY_REVIEWED) al contrato de error", async () => {
      const { ModerationError } = await import("@escaperoom/shared/services");
      const resolveReport = vi
        .fn()
        .mockRejectedValue(new ModerationError("ALREADY_REVIEWED", "Ya se revisó este reporte"));
      mocks.getModerationService.mockReturnValue({ resolveReport });
      const { resolveModerationReport } = await import("@/actions/moderation");

      const result = await resolveModerationReport({ id: "r1", status: "dismissed" });

      expect(result).toEqual({
        ok: false,
        error: { code: "ALREADY_REVIEWED", message: "Ya se revisó este reporte" },
      });
    });
  });

  describe("resolveModerationAppeal", () => {
    it("resuelve la apelación con el mismo ModerationService.resolveAppeal", async () => {
      const resolveAppeal = vi.fn().mockResolvedValue({
        appeal: { id: "a1", status: "upheld" },
        standing: { strikes: 0 },
      });
      mocks.getModerationService.mockReturnValue({ resolveAppeal });
      const { resolveModerationAppeal } = await import("@/actions/moderation");

      const result = await resolveModerationAppeal({ id: "a1", decision: "upheld" });

      expect(result.ok).toBe(true);
      expect(resolveAppeal).toHaveBeenCalledWith(MODERATOR, "a1", { decision: "upheld" });
    });
  });

  describe("reviewModerationAudio", () => {
    it("aprueba un audio comprobando autorización antes de revisar", async () => {
      const authorizeModeration = vi.fn().mockResolvedValue(undefined);
      const reviewUpload = vi.fn().mockResolvedValue({ id: "au1", status: "approved" });
      mocks.getAudioAssetService.mockReturnValue({ authorizeModeration, reviewUpload });
      const { reviewModerationAudio } = await import("@/actions/moderation");

      const result = await reviewModerationAudio({ id: "au1", decision: "approved" });

      expect(result.ok).toBe(true);
      expect(authorizeModeration).toHaveBeenCalledWith(MODERATOR);
      expect(reviewUpload).toHaveBeenCalledWith(MODERATOR, "au1", { decision: "approved" });
    });

    it("rechaza un audio con motivo", async () => {
      const authorizeModeration = vi.fn().mockResolvedValue(undefined);
      const reviewUpload = vi.fn().mockResolvedValue({ id: "au1", status: "rejected" });
      mocks.getAudioAssetService.mockReturnValue({ authorizeModeration, reviewUpload });
      const { reviewModerationAudio } = await import("@/actions/moderation");

      const result = await reviewModerationAudio({
        id: "au1",
        decision: "rejected",
        reason: "voz identificable",
      });

      expect(result.ok).toBe(true);
      expect(reviewUpload).toHaveBeenCalledWith(MODERATOR, "au1", {
        decision: "rejected",
        reason: "voz identificable",
      });
    });

    it("traduce `AudioError` (p. ej. FORBIDDEN) al contrato de error", async () => {
      const { AudioError } = await import("@escaperoom/shared/services");
      const authorizeModeration = vi
        .fn()
        .mockRejectedValue(new AudioError("FORBIDDEN", "Solo moderadores"));
      mocks.getAudioAssetService.mockReturnValue({ authorizeModeration, reviewUpload: vi.fn() });
      const { reviewModerationAudio } = await import("@/actions/moderation");

      const result = await reviewModerationAudio({ id: "au1", decision: "approved" });

      expect(result).toEqual({ ok: false, error: { code: "FORBIDDEN", message: "Solo moderadores" } });
    });
  });
});
