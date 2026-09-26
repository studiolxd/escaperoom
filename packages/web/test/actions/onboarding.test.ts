// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ANONYMOUS_ACTOR,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { __resetInMemoryRateLimitersForTests } from "@escaperoom/kit/rate-limit";
import { beforeEach, describe, expect, it, vi } from "vitest";

__resetInMemoryRateLimitersForTests();

const mocks = vi.hoisted(() => ({
  consumeActionRateLimit: vi.fn(),
  resolveActorFromHeaders: vi.fn(),
  drafts: null as RoomDraftService | null,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/actions/action-result", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  consumeActionRateLimit: mocks.consumeActionRateLimit,
}));
vi.mock("@/server/context", () => ({ resolveActorFromHeaders: mocks.resolveActorFromHeaders }));
vi.mock("@/server/services", () => ({ getRoomDraftService: () => mocks.drafts }));

const author: Actor = { userId: "autora", organizationId: null, role: "member" };

const fixturePath = fileURLToPath(
  new URL("../../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
vi.mock("@/lib/room-preview-fixture", () => ({
  readReyAldricRoomPackageJson: () => readFileSync(fixturePath, "utf8"),
}));

describe("createOnboardingRoomAction (server action)", () => {
  beforeEach(() => {
    mocks.consumeActionRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfter: 0 });
    mocks.resolveActorFromHeaders.mockReset().mockResolvedValue(author);
    mocks.drafts = createRoomDraftService({ store: createInMemoryRoomDraftStore([]) });
  });

  it("crea una sala en blanco y devuelve su roomId", async () => {
    const { createOnboardingRoomAction } = await import("@/actions/onboarding");

    const result = await createOnboardingRoomAction({ template: "blank" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ roomId: expect.any(String), template: "blank" });
  });

  it("crea una copia editable del Rey Aldric", async () => {
    const { createOnboardingRoomAction } = await import("@/actions/onboarding");

    const result = await createOnboardingRoomAction({ template: "rey-aldric" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.template).toBe("rey-aldric");
  });

  it("sin sesión responde UNAUTHORIZED sin llamar al servicio", async () => {
    mocks.resolveActorFromHeaders.mockResolvedValue(ANONYMOUS_ACTOR);
    const { createOnboardingRoomAction } = await import("@/actions/onboarding");

    const result = await createOnboardingRoomAction({ template: "blank" });

    expect(result).toEqual({ ok: false, error: { code: "UNAUTHORIZED", message: expect.any(String) } });
  });

  it("rechaza una plantilla desconocida con VALIDATION_ERROR", async () => {
    const { createOnboardingRoomAction } = await import("@/actions/onboarding");

    const result = await createOnboardingRoomAction({ template: "otra" } as never);

    expect(result).toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.any(String) },
    });
  });

  it("respeta el rate limit `onboarding-room-create`: RATE_LIMITED sin resolver el actor", async () => {
    mocks.consumeActionRateLimit.mockResolvedValue({ ok: false, retryAfter: 20 });
    const { createOnboardingRoomAction } = await import("@/actions/onboarding");

    const result = await createOnboardingRoomAction({ template: "blank" });

    expect(result).toEqual({ ok: false, error: { code: "RATE_LIMITED", message: expect.any(String) } });
    expect(mocks.consumeActionRateLimit).toHaveBeenCalledWith("onboarding-room-create");
    expect(mocks.resolveActorFromHeaders).not.toHaveBeenCalled();
  });
});
