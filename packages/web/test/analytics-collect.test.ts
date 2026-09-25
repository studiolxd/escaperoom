// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createAnalyticsQueue,
  emitAnalyticsEvents,
  type AnalyticsEventInput,
} from "@escaperoom/shared/analytics";
import type { QueueHandle } from "@escaperoom/kit/queue";
import { ANONYMOUS_ACTOR, type Actor } from "@escaperoom/shared/services";
import {
  ANALYTICS_SERVER_SECRET_HEADER,
  createAnalyticsCollectHandler,
  type AnalyticsCollectDeps,
} from "../src/server/rest/analytics-collect";

const SERVER_SECRET = "s".repeat(32);

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/analytics/collect", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function serverRequest(body: unknown): Request {
  return jsonRequest(body, { [ANALYTICS_SERVER_SECRET_HEADER]: SERVER_SECRET });
}

function makeHandler(overrides: Partial<AnalyticsCollectDeps> = {}) {
  const deps: AnalyticsCollectDeps = {
    emit: vi.fn(async () => undefined),
    resolveActor: async () => ANONYMOUS_ACTOR,
    serverSecret: null,
    ...overrides,
  };
  return { POST: createAnalyticsCollectHandler(deps), deps };
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
    const { POST } = makeHandler({ emit });

    const response = await POST(jsonRequest({ eventType: "onboarding_step", payload: { step: "welcome" } }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toEqual([
      { eventType: "onboarding_step", payload: { step: "welcome" }, playerId: undefined },
    ]);

    release();
  });

  it("encola cada evento del servidor en la cola mockeada", async () => {
    const enqueue = vi.fn(async () => "job-1");
    const queue = {
      name: "analytics.event",
      enqueue,
    } as unknown as QueueHandle<AnalyticsEventInput>;
    const { POST } = makeHandler({
      emit: (events) => emitAnalyticsEvents(events, queue),
      serverSecret: SERVER_SECRET,
    });

    const response = await POST(
      serverRequest([{ eventType: "user_registered" }, { eventType: "organizer_panel_viewed" }]),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 2 });
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(2));
    expect(enqueue).toHaveBeenCalledWith({ eventType: "user_registered", payload: {} });
  });

  it("rechaza un evento inválido con 400, error claro y sin encolar", async () => {
    const { POST, deps } = makeHandler();

    const response = await POST(jsonRequest({ eventType: "not_a_real_event" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_EVENT");
    expect(body.error.issues.some((issue: { path: string }) => issue.path === "eventType")).toBe(
      true,
    );
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it("rechaza un payload incompleto del tipo con ruta de campo", async () => {
    const { POST } = makeHandler();

    const response = await POST(jsonRequest({ eventType: "onboarding_step", payload: {} }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.issues.some((issue: { path: string }) => issue.path === "payload.step")).toBe(
      true,
    );
  });

  it("responde 400 INVALID_JSON si el cuerpo no es JSON", async () => {
    const { POST } = makeHandler();

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
    const { POST } = makeHandler({ emit: () => Promise.reject(new Error("Redis caído")) });

    const response = await POST(jsonRequest({ eventType: "onboarding_step", payload: { step: "x" } }));

    expect(response.status).toBe(202);
  });

  it("degrada a no-op con QUEUES_ENABLED=false (sin Redis) y responde 202", async () => {
    const queue = createAnalyticsQueue({ enabled: false });
    const { POST } = makeHandler({ emit: (events) => emitAnalyticsEvents(events, queue) });

    const response = await POST(jsonRequest({ eventType: "onboarding_step", payload: { step: "x" } }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });
  });

  // A-2: el navegador solo emite `onboarding_step`; el resto de la taxonomía
  // (compras, sesiones, claves…) exige el secreto servidor-a-servidor.
  describe("A-2 · lista blanca del navegador y playerId de sesión", () => {
    it("rechaza con 400 FORBIDDEN_EVENT_TYPE un tipo de servidor sin el secreto", async () => {
      const { POST, deps } = makeHandler();

      const response = await POST(jsonRequest({ eventType: "purchase_completed", payload: { type: "room", amount: 100 } }));

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("FORBIDDEN_EVENT_TYPE");
      expect(deps.emit).not.toHaveBeenCalled();
    });

    it("acepta un tipo de servidor cuando trae el secreto correcto", async () => {
      const { POST, deps } = makeHandler({ serverSecret: SERVER_SECRET });

      const response = await POST(
        serverRequest({ eventType: "purchase_completed", payload: { type: "room", amount: 100 } }),
      );

      expect(response.status).toBe(202);
      expect(deps.emit).toHaveBeenCalledTimes(1);
    });

    it("no acepta el secreto servidor-a-servidor si no coincide", async () => {
      const { POST, deps } = makeHandler({ serverSecret: SERVER_SECRET });

      const response = await POST(
        jsonRequest(
          { eventType: "purchase_completed", payload: { type: "room", amount: 100 } },
          { [ANALYTICS_SERVER_SECRET_HEADER]: "algo-distinto" },
        ),
      );

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("FORBIDDEN_EVENT_TYPE");
      expect(deps.emit).not.toHaveBeenCalled();
    });

    it("ignora el playerId del cuerpo y usa el de la sesión", async () => {
      const actor: Actor = { userId: "user-real", organizationId: null, role: "member" };
      const { POST, deps } = makeHandler({ resolveActor: async () => actor });

      await POST(
        jsonRequest({
          eventType: "onboarding_step",
          playerId: "usuario-suplantado",
          payload: { step: "welcome" },
        }),
      );

      expect(deps.emit).toHaveBeenCalledWith([
        { eventType: "onboarding_step", payload: { step: "welcome" }, playerId: "user-real" },
      ]);
    });

    it("borra el playerId si la sesión es anónima, aunque venga en el cuerpo", async () => {
      const { POST, deps } = makeHandler({ resolveActor: async () => ANONYMOUS_ACTOR });

      await POST(
        jsonRequest({
          eventType: "onboarding_step",
          playerId: "usuario-suplantado",
          payload: { step: "welcome" },
        }),
      );

      expect(deps.emit).toHaveBeenCalledWith([
        { eventType: "onboarding_step", payload: { step: "welcome" }, playerId: undefined },
      ]);
    });
  });
});
