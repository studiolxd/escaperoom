// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { processAnalyticsEvent, type AnalyticsEventStore } from "../src/worker";

describe("processAnalyticsEvent", () => {
  it("inserta el evento con el sobre completo y el payload", async () => {
    const create = vi.fn(async () => ({ id: 1n }));
    const store: AnalyticsEventStore = { create };

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
