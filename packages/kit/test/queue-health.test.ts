// @vitest-environment node
import { describe, expect, it } from "vitest";
import type Redis from "ioredis";
import { computeWorkerHealth, redisResponds } from "../src/queue/health";

const fakeRedis = (ping: () => Promise<unknown>) => ({ ping }) as unknown as Redis;

describe("redisResponds", () => {
  it("is false when there is no client", async () => {
    expect(await redisResponds(null)).toBe(false);
  });

  it("is true when PING returns PONG", async () => {
    expect(await redisResponds(fakeRedis(async () => "PONG"))).toBe(true);
  });

  it("is false when PING rejects", async () => {
    expect(
      await redisResponds(
        fakeRedis(async () => {
          throw new Error("connection lost");
        }),
      ),
    ).toBe(false);
  });

  it("is false when PING hangs past the timeout (never throws)", async () => {
    const hang = fakeRedis(() => new Promise<never>(() => {}));
    expect(await redisResponds(hang, 20)).toBe(false);
  });
});

describe("computeWorkerHealth", () => {
  const up = fakeRedis(async () => "PONG");

  it("is ok when running, not shutting down, and Redis responds", async () => {
    const h = await computeWorkerHealth({
      shuttingDown: false,
      workersRunning: true,
      redis: up,
    });
    expect(h).toEqual({ ok: true, workersRunning: true, shuttingDown: false });
  });

  it("is unhealthy while shutting down", async () => {
    const h = await computeWorkerHealth({ shuttingDown: true, workersRunning: true, redis: up });
    expect(h.ok).toBe(false);
  });

  it("is unhealthy when a worker stopped consuming", async () => {
    const h = await computeWorkerHealth({ shuttingDown: false, workersRunning: false, redis: up });
    expect(h.ok).toBe(false);
  });

  it("is unhealthy when Redis is unreachable", async () => {
    const h = await computeWorkerHealth({ shuttingDown: false, workersRunning: true, redis: null });
    expect(h.ok).toBe(false);
  });
});
