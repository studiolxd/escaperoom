// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const redisCtor = vi.hoisted(() => vi.fn());

vi.mock("../src/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("ioredis", () => ({
  default: class RedisMock {
    on = vi.fn().mockReturnThis();
    constructor(url: string, opts: unknown) {
      redisCtor(url, opts);
    }
  },
}));

import {
  createProducerRedis,
  createQueueRedis,
  getRedis,
  getSubscriberRedis,
  redisPrefix,
} from "../src/redis/index";

const globalForRedis = globalThis as { redis?: unknown; redisSubscriber?: unknown };

describe("redis factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("REDIS_URL", undefined);
    vi.stubEnv("REDIS_PREFIX", undefined);
    vi.stubEnv("APP_NAME", "My SaaS App");
    delete globalForRedis.redis;
    delete globalForRedis.redisSubscriber;
  });

  it("getRedis returns null without REDIS_URL", () => {
    expect(getRedis()).toBeNull();
    expect(redisCtor).not.toHaveBeenCalled();
  });

  it("getRedis is a lazy global singleton", () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:56380");
    const first = getRedis();
    expect(getRedis()).toBe(first);
    expect(redisCtor).toHaveBeenCalledExactlyOnceWith("redis://localhost:56380", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  });

  it("createQueueRedis throws without REDIS_URL", () => {
    expect(() => createQueueRedis()).toThrow(/REDIS_URL/);
  });

  it("createQueueRedis opens a fresh connection with BullMQ-required options", () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:56380");
    const a = createQueueRedis();
    const b = createQueueRedis();
    expect(a).not.toBe(b);
    expect(redisCtor).toHaveBeenCalledTimes(2);
    expect(redisCtor).toHaveBeenCalledWith("redis://localhost:56380", {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
  });

  it("createProducerRedis fails fast (bounded retries, no offline queue)", () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:56380");
    createProducerRedis();
    expect(redisCtor).toHaveBeenCalledWith("redis://localhost:56380", {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
  });

  it("getSubscriberRedis is null without REDIS_URL and separate from getRedis", () => {
    expect(getSubscriberRedis()).toBeNull();
    vi.stubEnv("REDIS_URL", "redis://localhost:56380");
    const sub = getSubscriberRedis();
    expect(sub).not.toBeNull();
    expect(getSubscriberRedis()).toBe(sub);
    expect(sub).not.toBe(getRedis());
  });

  it("redisPrefix slugs APP_NAME and honours REDIS_PREFIX", () => {
    expect(redisPrefix()).toBe("my-saas-app");
    vi.stubEnv("REDIS_PREFIX", "custom");
    expect(redisPrefix()).toBe("custom");
  });
});
