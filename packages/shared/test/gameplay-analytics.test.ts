import { describe, expect, it } from "vitest";
import {
  createGameplayAnalyticsEmitter,
  emitGameplayEvents,
  mapGameplayEvent,
  type GameplayAnalyticsContext,
  type GameplayEvent,
} from "../src/analytics";
import type { AnalyticsEventInput } from "../src/schemas/analytics";
import { validateAnalyticsEvent } from "../src/schemas/analytics";
import type { QueueHandle } from "@escaperoom/kit/queue";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const ROOM_VERSION_ID = "22222222-2222-4222-8222-222222222222";

const context: GameplayAnalyticsContext = {
  sessionId: SESSION_ID,
  playerId: "p1",
  roomVersionId: ROOM_VERSION_ID,
};

interface Case {
  name: string;
  input: GameplayEvent;
  eventType: string;
  payload: Record<string, unknown>;
}

const CASES: Case[] = [
  {
    name: "puzzle_available",
    input: {
      type: "puzzle_available",
      puzzleId: "p-candado-arca",
      puzzleType: "code_lock",
      roomId: "salon",
    },
    eventType: "puzzle_available",
    payload: { puzzle_id: "p-candado-arca", type: "code_lock", room_id: "salon" },
  },
  {
    name: "puzzle_attempted",
    input: { type: "puzzle_attempted", puzzleId: "p-candado-arca", attempt: 2 },
    eventType: "puzzle_attempted",
    payload: { puzzle_id: "p-candado-arca", attempt_n: 2 },
  },
  {
    name: "puzzle_solved",
    input: {
      type: "puzzle_solved",
      puzzleId: "p-candado-arca",
      puzzleType: "code_lock",
      durationSinceAvailable: 42.5,
      attempts: 3,
      hintsUsedBefore: 1,
    },
    eventType: "puzzle_solved",
    payload: {
      puzzle_id: "p-candado-arca",
      type: "code_lock",
      duration_since_available: 42.5,
      attempts: 3,
      hints_used_before: 1,
    },
  },
  {
    name: "puzzle_failed",
    input: { type: "puzzle_failed", puzzleId: "p-candado-arca", reason: "attempts" },
    eventType: "puzzle_failed",
    payload: { puzzle_id: "p-candado-arca", reason: "attempts" },
  },
  {
    name: "hint_requested → hint_viewed",
    input: { type: "hint_requested", puzzleId: "p-candado-arca", tier: 2 },
    eventType: "hint_viewed",
    payload: { puzzle_id: "p-candado-arca", tier: 2 },
  },
  {
    name: "item_granted",
    input: { type: "item_granted", itemId: "llave-bronce", source: "puzzle" },
    eventType: "item_granted",
    payload: { item_id: "llave-bronce", source: "puzzle" },
  },
  {
    name: "item_combined",
    input: {
      type: "item_combined",
      inputs: ["mechero", "vela"],
      output: "antorcha",
      success: true,
    },
    eventType: "item_combined",
    payload: { inputs: ["mechero", "vela"], output: "antorcha", success: true },
  },
  {
    name: "dialog_read",
    input: { type: "dialog_read", dialogId: "d-bienvenida" },
    eventType: "dialog_read",
    payload: { dialog_id: "d-bienvenida" },
  },
];

describe("mapGameplayEvent (specs/16 §2.2)", () => {
  it.each(CASES)("mapea $name al tipo y payload correctos", ({ input, eventType, payload }) => {
    const mapped = mapGameplayEvent(input, context);
    expect(mapped).not.toBeNull();
    expect(mapped?.eventType).toBe(eventType);
    expect(mapped?.payload).toEqual(payload);
  });

  it.each(CASES)("el payload de $name respeta el esquema Zod", ({ input }) => {
    const mapped = mapGameplayEvent(input, context);
    expect(mapped).not.toBeNull();
    const validation = validateAnalyticsEvent(mapped);
    expect(validation.ok).toBe(true);
  });

  it("propaga el contexto de sesión en el sobre", () => {
    const mapped = mapGameplayEvent(CASES[0]!.input, context);
    expect(mapped?.sessionId).toBe(SESSION_ID);
    expect(mapped?.playerId).toBe("p1");
    expect(mapped?.roomVersionId).toBe(ROOM_VERSION_ID);
  });

  it("mapea sin contexto (el sobre solo lleva tipo y payload)", () => {
    const mapped = mapGameplayEvent({ type: "dialog_read", dialogId: "d-1" });
    expect(mapped).toEqual({
      eventType: "dialog_read",
      payload: { dialog_id: "d-1" },
    });
  });

  it("un evento desconocido no emite (devuelve null)", () => {
    const mapped = mapGameplayEvent({ type: "not_a_gameplay_event" } as unknown as GameplayEvent);
    expect(mapped).toBeNull();
  });
});

describe("emitGameplayEvents (punto de emisión)", () => {
  function fakeQueue(): {
    queue: QueueHandle<AnalyticsEventInput>;
    enqueued: AnalyticsEventInput[];
  } {
    const enqueued: AnalyticsEventInput[] = [];
    const queue: QueueHandle<AnalyticsEventInput> = {
      name: "analytics.event.test",
      async enqueue(payload) {
        enqueued.push(payload);
        return `job-${enqueued.length}`;
      },
      getQueue: () => null,
    };
    return { queue, enqueued };
  }

  it("mapea y encola los eventos válidos, descartando los desconocidos", async () => {
    const { queue, enqueued } = fakeQueue();
    const emit = createGameplayAnalyticsEmitter(queue);

    const result = await emit(
      [CASES[0]!.input, { type: "nope" } as unknown as GameplayEvent, CASES[7]!.input],
      { sessionId: SESSION_ID, playerId: "p1" },
    );

    expect(result.accepted).toBe(2);
    expect(result.skipped).toBe(1);
    expect(enqueued.map((event) => event.eventType)).toEqual(["puzzle_available", "dialog_read"]);
  });

  it("con solo eventos desconocidos no toca la cola", async () => {
    const { queue, enqueued } = fakeQueue();
    const result = await emitGameplayEvents(
      [{ type: "nope" } as unknown as GameplayEvent],
      {},
      queue,
    );

    expect(result).toEqual({ accepted: 0, jobIds: [], skipped: 1 });
    expect(enqueued).toHaveLength(0);
  });
});
