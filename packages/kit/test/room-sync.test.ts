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

import { draftUpdateChannel } from "../src/room-sync/channel";
import { publishDraftUpdate } from "../src/room-sync/publish";
import { subscribeDraftUpdates } from "../src/room-sync/subscribe";

describe("draftUpdateChannel", () => {
  it("namespaces the channel under the redis prefix", () => {
    expect(draftUpdateChannel()).toBe("app:editor-sync:draft-updates");
  });
});

describe("publishDraftUpdate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op without Redis", async () => {
    mocks.getRedis.mockReturnValue(null);
    await expect(
      publishDraftUpdate({
        roomId: "r1",
        update: new Uint8Array([1, 2, 3]),
        authorId: "u1",
        originId: "p1",
      }),
    ).resolves.toBe(false);
  });

  it("publishes the update as base64 JSON on the draft-updates channel", async () => {
    const publish = vi.fn(async () => 1);
    mocks.getRedis.mockReturnValue({ publish });
    const update = new Uint8Array([1, 2, 3]);
    await expect(
      publishDraftUpdate({ roomId: "r1", update, authorId: "u1", originId: "p1" }),
    ).resolves.toBe(true);
    expect(publish).toHaveBeenCalledWith(
      "app:editor-sync:draft-updates",
      JSON.stringify({
        roomId: "r1",
        authorId: "u1",
        originId: "p1",
        update: Buffer.from(update).toString("base64"),
      }),
    );
  });

  it("fails open (returns false) when Redis publish throws", async () => {
    mocks.getRedis.mockReturnValue({
      publish: vi.fn(async () => Promise.reject(new Error("down"))),
    });
    await expect(
      publishDraftUpdate({
        roomId: "r1",
        update: new Uint8Array([1]),
        authorId: null,
        originId: "p1",
      }),
    ).resolves.toBe(false);
    expect(mocks.logger.warn).toHaveBeenCalled();
  });
});

describe("subscribeDraftUpdates", () => {
  const globalForRoomSync = globalThis as unknown as {
    draftUpdateListeners?: Set<unknown>;
    draftUpdateSubscribed?: boolean;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // `ensureSubscribed` caches the "already subscribed" flag on `globalThis`
    // (HMR-safety in prod) — reset it so each test wires its own mock connection.
    delete globalForRoomSync.draftUpdateListeners;
    delete globalForRoomSync.draftUpdateSubscribed;
  });

  it("returns a noop unsubscribe when Redis is unavailable", () => {
    mocks.getSubscriberRedis.mockReturnValue(null);
    const unsubscribe = subscribeDraftUpdates(() => {});
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("decodes base64 updates and delivers them to listeners on the channel", async () => {
    const handlers: Array<(ch: string, msg: string) => void> = [];
    const redis = {
      subscribe: vi.fn(async () => 1),
      on: vi.fn((event: string, handler: (ch: string, msg: string) => void) => {
        if (event === "message") handlers.push(handler);
      }),
    };
    mocks.getSubscriberRedis.mockReturnValue(redis);

    const received: unknown[] = [];
    const unsubscribe = subscribeDraftUpdates((event) => received.push(event));

    const update = new Uint8Array([9, 8, 7]);
    const payload = JSON.stringify({
      roomId: "r1",
      authorId: "u1",
      originId: "other-process",
      update: Buffer.from(update).toString("base64"),
    });
    for (const handler of handlers) handler("app:editor-sync:draft-updates", payload);

    expect(received).toEqual([
      { roomId: "r1", authorId: "u1", originId: "other-process", update },
    ]);
    unsubscribe();
  });

  it("ignores messages on other channels", () => {
    const handlers: Array<(ch: string, msg: string) => void> = [];
    const redis = {
      subscribe: vi.fn(async () => 1),
      on: vi.fn((event: string, handler: (ch: string, msg: string) => void) => {
        if (event === "message") handlers.push(handler);
      }),
    };
    mocks.getSubscriberRedis.mockReturnValue(redis);

    const received: unknown[] = [];
    subscribeDraftUpdates((event) => received.push(event));
    for (const handler of handlers) handler("some:other:channel", "{}");
    expect(received).toEqual([]);
  });
});
