// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  add: vi.fn(async () => ({ id: "job-1" })),
  addBulk: vi.fn(async (items: Array<{ data: unknown }>) =>
    items.map((_, i) => ({ id: `job-${i + 1}` })),
  ),
}));

vi.mock("../src/logger", () => ({ logger: mocks.logger }));
vi.mock("../src/redis", () => ({
  createProducerRedis: vi.fn(() => ({ quit: vi.fn() })),
  redisPrefix: vi.fn(() => "app"),
}));
vi.mock("bullmq", () => ({
  Queue: class {
    add = mocks.add;
    addBulk = mocks.addBulk;
  },
}));

import { createDefineQueue, isQueueInfraError, readQueuesRuntimeConfig } from "../src/queue/define";

describe("defineQueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is inert (no Redis, no BullMQ) when queues are disabled", async () => {
    const defineQueue = createDefineQueue({ enabled: false });
    const queue = defineQueue<{ a: number }>({ name: "analytics" });

    expect(queue.getQueue()).toBeNull();
    await expect(queue.enqueue({ a: 1 })).resolves.toBeNull();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("enqueues through BullMQ when enabled and returns the job id", async () => {
    const defineQueue = createDefineQueue({ enabled: true });
    const queue = defineQueue<{ a: number }>({ name: "analytics" });
    await expect(queue.enqueue({ a: 1 })).resolves.toBe("job-1");
    expect(mocks.add).toHaveBeenCalledWith("analytics", { a: 1 }, undefined);
  });

  it("rejects an invalid custom jobId instead of confusing it with a Redis blip", async () => {
    const defineQueue = createDefineQueue({ enabled: true });
    const queue = defineQueue<Record<string, never>>({ name: "analytics" });
    await expect(queue.enqueue({}, { jobId: "a:b" })).rejects.toThrow(/jobId inválido/);
  });

  // B-23: addBulk() en un round-trip en vez de un enqueue() por elemento.
  describe("enqueueBulk", () => {
    it("is a no-op returning one null per item when queues are disabled", async () => {
      const defineQueue = createDefineQueue({ enabled: false });
      const queue = defineQueue<{ a: number }>({ name: "analytics" });
      await expect(queue.enqueueBulk([{ payload: { a: 1 } }, { payload: { a: 2 } }])).resolves.toEqual(
        [null, null],
      );
      expect(mocks.addBulk).not.toHaveBeenCalled();
    });

    it("returns [] without touching Redis for an empty batch", async () => {
      const defineQueue = createDefineQueue({ enabled: true });
      const queue = defineQueue<{ a: number }>({ name: "analytics" });
      await expect(queue.enqueueBulk([])).resolves.toEqual([]);
      expect(mocks.addBulk).not.toHaveBeenCalled();
    });

    it("adds every item in one addBulk() call, same order", async () => {
      const defineQueue = createDefineQueue({ enabled: true });
      const queue = defineQueue<{ a: number }>({ name: "analytics" });
      await expect(
        queue.enqueueBulk([{ payload: { a: 1 } }, { payload: { a: 2 } }, { payload: { a: 3 } }]),
      ).resolves.toEqual(["job-1", "job-2", "job-3"]);
      expect(mocks.addBulk).toHaveBeenCalledTimes(1);
      expect(mocks.addBulk).toHaveBeenCalledWith([
        { name: "analytics", data: { a: 1 }, opts: undefined, at: 0 },
        { name: "analytics", data: { a: 2 }, opts: undefined, at: 1 },
        { name: "analytics", data: { a: 3 }, opts: undefined, at: 2 },
      ]);
    });

    it("drops only the item with an invalid custom jobId, still adds the rest (production)", async () => {
      // Como enqueue(): fuera de producción, un jobId inválido lanza en vez de
      // devolver null (`reportJobIdDefect`) — se comprueba con NODE_ENV real.
      vi.stubEnv("NODE_ENV", "production");
      try {
        const defineQueue = createDefineQueue({ enabled: true });
        const queue = defineQueue<{ a: number }>({ name: "analytics" });
        const results = await queue.enqueueBulk([
          { payload: { a: 1 } },
          { payload: { a: 2 }, opts: { jobId: "a:b" } },
          { payload: { a: 3 } },
        ]);
        expect(results).toEqual(["job-1", null, "job-2"]);
        expect(mocks.addBulk).toHaveBeenCalledTimes(1);
        expect(mocks.addBulk).toHaveBeenCalledWith([
          { name: "analytics", data: { a: 1 }, opts: undefined, at: 0 },
          { name: "analytics", data: { a: 3 }, opts: undefined, at: 2 },
        ]);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});

describe("readQueuesRuntimeConfig", () => {
  it("defaults the feature off and carries the shared job options", () => {
    const config = readQueuesRuntimeConfig({});
    expect(config.enabled).toBe(false);
    expect(config.defaultJobOptions?.attempts).toBe(3);
  });

  it("honours QUEUES_ENABLED", () => {
    expect(readQueuesRuntimeConfig({ QUEUES_ENABLED: "true" }).enabled).toBe(true);
  });
});

describe("isQueueInfraError", () => {
  it("recognises Redis connectivity failures", () => {
    expect(isQueueInfraError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isQueueInfraError(new Error("Stream isn't writeable and enableOfflineQueue"))).toBe(
      true,
    );
  });

  it("does not swallow programming defects", () => {
    expect(isQueueInfraError(new Error("Custom Id cannot contain :"))).toBe(false);
    expect(isQueueInfraError(null)).toBe(false);
  });
});
