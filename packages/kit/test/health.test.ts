// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const getRedisMock = vi.fn();
vi.mock("../src/redis", () => ({ getRedis: () => getRedisMock() }));

import { createWorkerHealthHandler, redisHealth } from "../src/health/index";

describe("createWorkerHealthHandler", () => {
  const healthy = () =>
    createWorkerHealthHandler({
      shuttingDown: () => false,
      workersRunning: () => true,
    });

  it("responds 200 when the worker is alive", async () => {
    const res = await healthy()(new Request("http://localhost/healthz"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      workersRunning: true,
      shuttingDown: false,
    });
  });

  it("responds 503 while shutting down", async () => {
    const handler = createWorkerHealthHandler({
      shuttingDown: () => true,
      workersRunning: () => true,
    });
    const res = await handler(new Request("http://localhost/healthz"));
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });

  it("responds 404 for any non-GET method", async () => {
    const res = await healthy()(new Request("http://localhost/healthz", { method: "POST" }));
    expect(res.status).toBe(404);
  });

  it("responds 503 (not 500) when the Redis probe throws", async () => {
    const handler = createWorkerHealthHandler({
      shuttingDown: () => false,
      workersRunning: () => true,
      redis: () => ({ ping: () => Promise.reject(new Error("down")) }) as never,
    });
    const res = await handler(new Request("http://localhost/healthz"));
    expect(res.status).toBe(503);
  });
});

describe("redisHealth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    getRedisMock.mockReset();
  });

  it("reports not_configured without REDIS_URL", async () => {
    vi.stubEnv("REDIS_URL", undefined);
    getRedisMock.mockReturnValue(null);
    await expect(redisHealth()).resolves.toBe("not_configured");
  });

  it("reports up when PING resolves", async () => {
    getRedisMock.mockReturnValue({ ping: () => Promise.resolve("PONG") });
    await expect(redisHealth()).resolves.toBe("up");
  });

  it("reports down (not hung) when PING never resolves — E-12: acotado con timeout", async () => {
    vi.useFakeTimers();
    try {
      getRedisMock.mockReturnValue({ ping: () => new Promise<never>(() => {}) });
      const result = redisHealth();
      await vi.advanceTimersByTimeAsync(2000);
      await expect(result).resolves.toBe("down");
    } finally {
      vi.useRealTimers();
    }
  });
});
