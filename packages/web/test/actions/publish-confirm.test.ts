// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveBrowserActorFromHeaders: vi.fn(),
  getPublishConfirmationService: vi.fn(),
}));

let testHeaders = new Headers({ "sec-fetch-site": "same-origin" });
vi.mock("next/headers", () => ({ headers: async () => testHeaders }));
vi.mock("@/server/context", () => ({
  resolveBrowserActorFromHeaders: mocks.resolveBrowserActorFromHeaders,
}));
vi.mock("@/server/services", () => ({
  getPublishConfirmationService: mocks.getPublishConfirmationService,
}));

const ACTOR = { userId: "u1", organizationId: null, role: "member" as const };

describe("confirmPublish (server action)", () => {
  beforeEach(() => {
    testHeaders = new Headers({ "sec-fetch-site": "same-origin" });
    mocks.resolveBrowserActorFromHeaders.mockReset().mockResolvedValue(ACTOR);
    mocks.getPublishConfirmationService.mockReset();
  });

  it("confirma la publicación y devuelve la versión y los avisos", async () => {
    const confirm = vi.fn().mockResolvedValue({
      version: {
        id: "v1",
        semver: "1.0.0",
        changelog: null,
        packageFormat: "roompackage/v1",
        assetsHash: "hash",
        publishedAt: new Date("2026-01-01T00:00:00Z"),
      },
      report: { checks: [{ id: "c1", status: "warning", summary: "aviso" }] },
      assets: [],
      moderationFlags: [],
    });
    mocks.getPublishConfirmationService.mockReturnValue({ confirm });
    const { confirmPublish } = await import("@/actions/publish-confirm");

    const result = await confirmPublish({ token: "tok" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.version.semver).toBe("1.0.0");
      expect(result.data.warnings).toEqual([{ id: "c1", summary: "aviso" }]);
    }
    expect(confirm).toHaveBeenCalledWith(ACTOR, "tok");
  });

  it("rechaza con BEARER_NOT_ALLOWED si hay cabecera Authorization, sin resolver el actor", async () => {
    testHeaders = new Headers({ "sec-fetch-site": "same-origin", authorization: "Bearer x" });
    const confirm = vi.fn();
    mocks.getPublishConfirmationService.mockReturnValue({ confirm });
    const { confirmPublish } = await import("@/actions/publish-confirm");

    const result = await confirmPublish({ token: "tok" });

    expect(result).toEqual({
      ok: false,
      error: { code: "BEARER_NOT_ALLOWED", message: expect.any(String) },
    });
    expect(mocks.resolveBrowserActorFromHeaders).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("rechaza con CROSS_SITE si Sec-Fetch-Site no es same-origin", async () => {
    testHeaders = new Headers({ "sec-fetch-site": "cross-site" });
    const { confirmPublish } = await import("@/actions/publish-confirm");

    const result = await confirmPublish({ token: "tok" });

    expect(result).toEqual({ ok: false, error: { code: "CROSS_SITE", message: expect.any(String) } });
  });

  it("devuelve VALIDATION_ERROR sin token", async () => {
    mocks.getPublishConfirmationService.mockReturnValue({ confirm: vi.fn() });
    const { confirmPublish } = await import("@/actions/publish-confirm");

    const result = await confirmPublish({ token: "" });

    expect(result).toEqual({ ok: false, error: { code: "VALIDATION_ERROR", message: expect.any(String) } });
  });

  it("traduce `PublishConfirmationError` (p. ej. EXPIRED) al contrato de error", async () => {
    const { PublishConfirmationError } = await import("@escaperoom/shared/services");
    const confirm = vi
      .fn()
      .mockRejectedValue(new PublishConfirmationError("EXPIRED", "El enlace ha caducado"));
    mocks.getPublishConfirmationService.mockReturnValue({ confirm });
    const { confirmPublish } = await import("@/actions/publish-confirm");

    const result = await confirmPublish({ token: "tok" });

    expect(result).toEqual({ ok: false, error: { code: "EXPIRED", message: "El enlace ha caducado" } });
  });

  it("devuelve PUBLISH_CONFIRM_DISABLED cuando el servicio no está configurado", async () => {
    mocks.getPublishConfirmationService.mockReturnValue(null);
    const { confirmPublish } = await import("@/actions/publish-confirm");
    const { PUBLISH_CONFIRM_DISABLED_ERROR } = await import("@escaperoom/shared/services");

    const result = await confirmPublish({ token: "tok" });

    expect(result).toEqual({
      ok: false,
      error: { code: PUBLISH_CONFIRM_DISABLED_ERROR, message: expect.any(String) },
    });
  });
});
