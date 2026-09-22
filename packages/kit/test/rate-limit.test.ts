// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRateLimiter, MemoryRateLimitStore } from "../src/rate-limit/memory";

describe("MemoryRateLimitStore", () => {
  it("allows hits within the window and rejects the one that exceeds the limit", async () => {
    const store = new MemoryRateLimitStore();
    const first = await store.hit("k", 2, 60);
    const second = await store.hit("k", 2, 60);
    const third = await store.hit("k", 2, 60);

    expect(first.ok).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.ok).toBe(true);
    expect(second.remaining).toBe(0);
    expect(third.ok).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
  });

  it("keeps counters separate per key", async () => {
    const store = new MemoryRateLimitStore();
    await store.hit("a", 1, 60);
    await store.hit("a", 1, 60);
    const other = await store.hit("b", 1, 60);
    expect(other.ok).toBe(true);
  });

  it("opens a fresh window once it expired", async () => {
    const store = new MemoryRateLimitStore();
    await store.hit("k", 1, 1);
    const blocked = await store.hit("k", 1, 1);
    expect(blocked.ok).toBe(false);

    await new Promise((r) => setTimeout(r, 1100));
    const reopened = await store.hit("k", 1, 1);
    expect(reopened.ok).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("delegates to the store", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter(store);
    await expect(limiter.check("k", 1, 60)).resolves.toMatchObject({ ok: true });
    await expect(limiter.check("k", 1, 60)).resolves.toMatchObject({ ok: false });
  });
});
