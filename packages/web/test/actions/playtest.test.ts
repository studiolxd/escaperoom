// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveActorFromHeaders: vi.fn(),
  getRoomDraftService: vi.fn(),
  getDraftSerializer: vi.fn(),
  getPlaytestLauncher: vi.fn(),
  runPlaytestCreation: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/context", () => ({ resolveActorFromHeaders: mocks.resolveActorFromHeaders }));
vi.mock("@/server/services", () => ({
  getRoomDraftService: mocks.getRoomDraftService,
  getDraftSerializer: mocks.getDraftSerializer,
}));
vi.mock("@/server/playtest-launcher", () => ({ getPlaytestLauncher: mocks.getPlaytestLauncher }));
vi.mock("@/server/rest/room-playtest", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runPlaytestCreation: mocks.runPlaytestCreation,
}));

const ACTOR = { userId: "autora", organizationId: null, role: "member" as const };
const RESPONSE = {
  roomId: "r1",
  playtestId: "pt-1",
  expiresAt: "2030-01-01T00:00:00.000Z",
  path: "/playtest/tok",
};

describe("createPlaytest (server action)", () => {
  beforeEach(() => {
    mocks.resolveActorFromHeaders.mockReset().mockResolvedValue(ACTOR);
    mocks.getRoomDraftService.mockReset().mockReturnValue({});
    mocks.getDraftSerializer.mockReset().mockReturnValue({});
    mocks.getPlaytestLauncher.mockReset().mockReturnValue({});
    mocks.runPlaytestCreation.mockReset();
  });

  it("crea el playtest y devuelve el link", async () => {
    mocks.runPlaytestCreation.mockResolvedValue(RESPONSE);
    const { createPlaytest } = await import("@/actions/playtest");

    const result = await createPlaytest("r1");

    expect(result).toEqual({ ok: true, data: RESPONSE });
    expect(mocks.runPlaytestCreation).toHaveBeenCalledWith(
      expect.objectContaining({ drafts: {}, serialize: {}, launcher: {} }),
      ACTOR,
      "r1",
    );
  });

  it("traduce `RoomDraftError` (p. ej. FORBIDDEN) al contrato de error", async () => {
    const { RoomDraftError } = await import("@escaperoom/shared/services");
    mocks.runPlaytestCreation.mockRejectedValue(
      new RoomDraftError("FORBIDDEN", "Solo el autor puede jugar el borrador"),
    );
    const { createPlaytest } = await import("@/actions/playtest");

    const result = await createPlaytest("r1");

    expect(result).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "Solo el autor puede jugar el borrador" },
    });
  });

  it("traduce `PlaytestCreationError` (p. ej. playtest deshabilitado) al contrato de error", async () => {
    const { PlaytestCreationError } = await import("@/server/rest/room-playtest");
    mocks.runPlaytestCreation.mockRejectedValue(
      new PlaytestCreationError(
        "PLAYTEST_DISABLED",
        "El playtest no está configurado en este entorno",
        503,
      ),
    );
    const { createPlaytest } = await import("@/actions/playtest");

    const result = await createPlaytest("r1");

    expect(result).toEqual({
      ok: false,
      error: { code: "PLAYTEST_DISABLED", message: "El playtest no está configurado en este entorno" },
    });
  });
});
