// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEventInput } from "@escaperoom/shared/analytics";
import {
  createAnalyticsEventBatcher,
  processAnalyticsEvent,
  type AnalyticsEventStore,
} from "../src/worker";

describe("processAnalyticsEvent", () => {
  it("inserta el evento con el sobre completo y el payload", async () => {
    const create = vi.fn(async () => ({ id: 1n }));
    const store: Pick<AnalyticsEventStore, "create"> = { create };

    await processAnalyticsEvent(store, {
      eventType: "player_joined",
      sessionId: "11111111-1111-4111-8111-111111111111",
      playerId: "p1",
      roomVersionId: "22222222-2222-4222-8222-222222222222",
      payload: { room_id: "r1" },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        eventType: "player_joined",
        sessionId: "11111111-1111-4111-8111-111111111111",
        playerId: "p1",
        roomVersionId: "22222222-2222-4222-8222-222222222222",
        payload: { room_id: "r1" },
      },
    });
  });

  it("rellena con null los ids ausentes", async () => {
    const create = vi.fn(async () => ({ id: 1n }));

    await processAnalyticsEvent({ create }, { eventType: "user_registered", payload: {} });

    expect(create).toHaveBeenCalledWith({
      data: {
        eventType: "user_registered",
        sessionId: null,
        playerId: null,
        roomVersionId: null,
        payload: {},
      },
    });
  });
});

// E-23: createMany por lotes en vez de un create() por evento.
describe("createAnalyticsEventBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const event = (eventType: string): AnalyticsEventInput =>
    ({ eventType, payload: {} }) as AnalyticsEventInput;

  it("agrupa hasta maxBatchSize en un único createMany", async () => {
    const createMany = vi.fn(async () => ({ count: 3 }));
    const batcher = createAnalyticsEventBatcher({ createMany }, { maxBatchSize: 3 });

    const adds = [batcher.add(event("a")), batcher.add(event("b")), batcher.add(event("c"))];
    await Promise.all(adds);

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ eventType: "a" }),
        expect.objectContaining({ eventType: "b" }),
        expect.objectContaining({ eventType: "c" }),
      ],
    });
  });

  it("vuelca por tiempo si no llega a llenar el lote", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const batcher = createAnalyticsEventBatcher({ createMany }, { maxBatchSize: 100, maxWaitMs: 50 });

    const pending = batcher.add(event("solo"));
    expect(createMany).not.toHaveBeenCalled();
    expect(batcher.pendingCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(50);
    await pending;

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ eventType: "solo" })] });
  });

  it("un createMany que falla rechaza solo ese lote, no los siguientes", async () => {
    const createMany = vi
      .fn()
      .mockRejectedValueOnce(new Error("db caída"))
      .mockResolvedValueOnce({ count: 1 });
    const batcher = createAnalyticsEventBatcher({ createMany }, { maxBatchSize: 1 });

    await expect(batcher.add(event("falla"))).rejects.toThrow("db caída");
    await expect(batcher.add(event("ok"))).resolves.toBeUndefined();
    expect(createMany).toHaveBeenCalledTimes(2);
  });

  it("flush() vuelca ya mismo sin esperar al temporizador (cierre del worker)", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const batcher = createAnalyticsEventBatcher({ createMany }, { maxBatchSize: 100, maxWaitMs: 10_000 });

    const pending = batcher.add(event("solo"));
    await batcher.flush();
    await pending;

    expect(createMany).toHaveBeenCalledTimes(1);
  });
});
