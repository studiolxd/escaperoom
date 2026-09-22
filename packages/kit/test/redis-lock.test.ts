// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRedis: vi.fn(),
  redisPrefix: vi.fn(() => "myapp"),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/redis/index", () => ({
  getRedis: mocks.getRedis,
  redisPrefix: mocks.redisPrefix,
}));
vi.mock("../src/logger", () => ({ logger: mocks.logger }));

import { withRedisLock } from "../src/redis/lock";

function fakeRedis() {
  return {
    set: vi.fn<(key: string, token: string, ...rest: unknown[]) => Promise<string | null>>(
      async () => "OK",
    ),
    eval: vi.fn(async () => 1),
  };
}

describe("withRedisLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRedis.mockReturnValue(null);
  });

  it("runs fn directly when Redis is not configured", async () => {
    const fn = vi.fn(async () => "done");
    await expect(withRedisLock("job", 1000, fn)).resolves.toBe("done");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("acquires with SET NX PX under the namespaced key and releases after", async () => {
    const redis = fakeRedis();
    mocks.getRedis.mockReturnValue(redis);

    const result = await withRedisLock("job", 5000, async () => 42);

    expect(result).toBe(42);
    expect(redis.set).toHaveBeenCalledExactlyOnceWith(
      "myapp:lock:job",
      expect.any(String),
      "PX",
      5000,
      "NX",
    );
    const token = redis.set.mock.calls[0]![1];
    expect(redis.eval).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("del"),
      1,
      "myapp:lock:job",
      token,
    );
  });

  it("skips (without running fn) when another holder owns the lock", async () => {
    const redis = fakeRedis();
    redis.set.mockResolvedValue(null);
    mocks.getRedis.mockReturnValue(redis);

    const fn = vi.fn(async () => "never");
    await expect(withRedisLock("job", 1000, fn)).resolves.toEqual({ skipped: "locked" });
    expect(fn).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("only one of two concurrent callers runs", async () => {
    const redis = fakeRedis();
    redis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
    mocks.getRedis.mockReturnValue(redis);

    const fn = vi.fn(async () => "ran");
    const [a, b] = await Promise.all([
      withRedisLock("job", 1000, fn),
      withRedisLock("job", 1000, fn),
    ]);

    expect([a, b]).toContain("ran");
    expect([a, b]).toContainEqual({ skipped: "locked" });
    expect(fn).toHaveBeenCalledOnce();
  });

  it("releases the lock even when fn throws", async () => {
    const redis = fakeRedis();
    mocks.getRedis.mockReturnValue(redis);

    await expect(
      withRedisLock("job", 1000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it("fails open when the acquire itself errors", async () => {
    const redis = fakeRedis();
    redis.set.mockRejectedValue(new Error("redis down"));
    mocks.getRedis.mockReturnValue(redis);

    const fn = vi.fn(async () => "ran");
    await expect(withRedisLock("job", 1000, fn)).resolves.toBe("ran");
    expect(mocks.logger.warn).toHaveBeenCalled();
  });
});
