// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { __resetInMemoryRateLimitersForTests, checkRouteRateLimit } from "../src/rate-limit/index";

// Ver la nota igual en `packages/web/test/rate-limit.test.ts` (entrada "Tests
// de rate limit deterministas", `docs/DEUDA.md`): defensa adicional, no la
// causa real del 429 (esa era `REDIS_PREFIX` en `scripts/verify-pr.sh`, ya
// arreglada).
__resetInMemoryRateLimitersForTests();

describe("checkRouteRateLimit", () => {
  it("is a no-op when disabled", async () => {
    await expect(checkRouteRateLimit("k", 1, 60, { enabled: false })).resolves.toEqual({
      ok: true,
      retryAfter: 0,
    });
  });

  it("limits with the default store when enabled", async () => {
    const key = `test-${Math.random()}`;
    await expect(checkRouteRateLimit(key, 1, 60)).resolves.toMatchObject({ ok: true });
    await expect(checkRouteRateLimit(key, 1, 60)).resolves.toMatchObject({ ok: false });
  });
});
