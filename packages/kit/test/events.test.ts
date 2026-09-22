// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRedis: vi.fn(),
  getSubscriberRedis: vi.fn(),
  redisPrefix: vi.fn(() => "app"),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/redis", () => ({
  getRedis: mocks.getRedis,
  getSubscriberRedis: mocks.getSubscriberRedis,
  redisPrefix: mocks.redisPrefix,
}));
vi.mock("../src/logger", () => ({ logger: mocks.logger }));

import { orgChannel, userChannel } from "../src/events/channels";
import { createEventPublisher } from "../src/events/publish";
import { subscribeChannels } from "../src/events/subscriber";

describe("event channels", () => {
  it("namespaces organization and user channels under the redis prefix", () => {
    expect(orgChannel("org_1")).toBe("app:events:org:org_1");
    expect(userChannel("u1")).toBe("app:events:user:u1");
  });
});

describe("createEventPublisher", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op when realtime is disabled", async () => {
    const publisher = createEventPublisher({ realtimeEnabled: false });
    await expect(
      publisher.publishOrgEvent("org_1", { type: "job.completed", jobName: "j", jobId: "1" }),
    ).resolves.toBe(false);
    expect(mocks.getRedis).not.toHaveBeenCalled();
  });

  it("is a no-op without Redis even when enabled", async () => {
    mocks.getRedis.mockReturnValue(null);
    const publisher = createEventPublisher({ realtimeEnabled: true });
    await expect(
      publisher.publishUserEvent("u1", { type: "notification.created", notificationType: "n" }),
    ).resolves.toBe(false);
  });

  it("publishes JSON to the user channel", async () => {
    const publish = vi.fn(async () => 1);
    mocks.getRedis.mockReturnValue({ publish });
    const publisher = createEventPublisher({ realtimeEnabled: true });
    const event = { type: "notification.created" as const, notificationType: "n" };
    await expect(publisher.publishUserEvent("u1", event)).resolves.toBe(true);
    expect(publish).toHaveBeenCalledWith("app:events:user:u1", JSON.stringify(event));
  });

  it("fails open when Redis publish throws", async () => {
    mocks.getRedis.mockReturnValue({
      publish: vi.fn(async () => Promise.reject(new Error("down"))),
    });
    const publisher = createEventPublisher({ realtimeEnabled: true });
    await expect(
      publisher.publishOrgEvent("org_1", {
        type: "job.failed",
        jobName: "j",
        jobId: "1",
        error: "x",
      }),
    ).resolves.toBe(false);
    expect(mocks.logger.warn).toHaveBeenCalled();
  });
});

describe("subscribeChannels", () => {
  it("returns a noop unsubscribe when Redis is unavailable", () => {
    mocks.getSubscriberRedis.mockReturnValue(null);
    const unsubscribe = subscribeChannels(["app:events:user:u1"], () => {});
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });
});
