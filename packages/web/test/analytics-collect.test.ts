// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createAnalyticsQueue,
  emitAnalyticsEvents,
  type AnalyticsEventInput,
} from "@escaperoom/shared/analytics";
import type { QueueHandle } from "@escaperoom/kit/queue";
import { createAnalyticsCollectHandler } from "../src/server/rest/analytics-collect";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/analytics/collect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analytics/collect", () => {
  it("responde 202 sin esperar al insert (emisión en vuelo)", async () => {
    let release!: () => void;
    const emit = vi.fn<(events: AnalyticsEventInput[]) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const POST = createAnalyticsCollectHandler({ emit });

    const response = await POST(
      jsonRequest({ eventType: "room_playtest_started", playerId: "p1" }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toEqual([
      { eventType: "room_playtest_started", playerId: "p1", payload: {} },
    ]);

    release();
  });

  it("encola cada evento en la cola mockeada", async () => {
    const enqueue = vi.fn(async () => "job-1");
    const queue = { name: "analytics.event", enqueue } as unknown as QueueHandle<AnalyticsEventInput>;
    const POST = createAnalyticsCollectHandler({
      emit: (events) => emitAnalyticsEvents(events, queue),
    });

    const response = await POST(
      jsonRequest([{ eventType: "user_registered" }, { eventType: "organizer_panel_viewed" }]),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 2 });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
    expect(enqueue).toHaveBeenCalledWith({ eventType: "user_registered", payload: {} });
  });

  it("rechaza un evento inválido con 400, error claro y sin encolar", async () => {
    const emit = vi.fn(async () => undefined);
    const POST = createAnalyticsCollectHandler({ emit });

    const response = await POST(jsonRequest({ eventType: "not_a_real_event" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_EVENT");
    expect(body.error.issues.some((issue: { path: string }) => issue.path === "eventType")).toBe(
      true,
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it("rechaza un payload incompleto del tipo con ruta de campo", async () => {
    const emit = vi.fn(async () => undefined);
    const POST = createAnalyticsCollectHandler({ emit });

    const response = await POST(jsonRequest({ eventType: "onboarding_step", payload: {} }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(
      body.error.issues.some((issue: { path: string }) => issue.path === "payload.step"),
    ).toBe(true);
  });

  it("responde 400 INVALID_JSON si el cuerpo no es JSON", async () => {
    const emit = vi.fn(async () => undefined);
    const POST = createAnalyticsCollectHandler({ emit });

    const response = await POST(
      new Request("http://localhost/api/analytics/collect", {
        method: "POST",
        body: "no soy json",
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_JSON");
  });

  it("degrada a 202 aunque la emisión falle (nunca rompe la request)", async () => {
    const emit = vi.fn(() => Promise.reject(new Error("Redis caído")));
    const POST = createAnalyticsCollectHandler({ emit });

    const response = await POST(jsonRequest({ eventType: "user_registered" }));

    expect(response.status).toBe(202);
  });

  it("degrada a no-op con QUEUES_ENABLED=false (sin Redis) y responde 202", async () => {
    const queue = createAnalyticsQueue({ enabled: false });
    const POST = createAnalyticsCollectHandler({
      emit: (events) => emitAnalyticsEvents(events, queue),
    });

    const response = await POST(jsonRequest({ eventType: "user_registered" }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });
  });
});
