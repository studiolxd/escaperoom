import { describe, expect, it } from "vitest";
import {
  ANALYTICS_MAX_BATCH,
  validateAnalyticsCollect,
  validateAnalyticsEvent,
} from "../src/schemas/analytics";

describe("taxonomía de analítica (specs/16 §2)", () => {
  it("acepta un evento válido de la taxonomía", () => {
    const result = validateAnalyticsEvent({
      eventType: "player_joined",
      sessionId: "11111111-1111-4111-8111-111111111111",
      playerId: "p1",
      payload: { room_id: "r1", session_id: "s1", player_n: 2, via: "key" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.eventType).toBe("player_joined");
  });

  it("acepta un evento sin payload y aplica el default {}", () => {
    const result = validateAnalyticsEvent({ eventType: "room_playtest_started" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.payload).toEqual({});
  });

  it("rechaza un eventType fuera de la taxonomía con ruta clara", () => {
    const result = validateAnalyticsEvent({ eventType: "not_a_real_event" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === "eventType")).toBe(true);
      expect(result.issues.every((issue) => issue.message.length > 0)).toBe(true);
    }
  });

  it("rechaza un payload incompleto del tipo con ruta de campo", () => {
    const result = validateAnalyticsEvent({ eventType: "onboarding_step", payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === "payload.step")).toBe(true);
    }
  });

  it("rechaza un id que no es uuid", () => {
    const result = validateAnalyticsEvent({
      eventType: "user_registered",
      sessionId: "no-soy-uuid",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === "sessionId")).toBe(true);
    }
  });

  it("valida lotes y señala el índice del evento inválido", () => {
    const result = validateAnalyticsCollect([
      { eventType: "user_registered" },
      { eventType: "not_a_real_event" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path === "[1].eventType")).toBe(true);
    }
  });

  it("acepta un lote válido y rechaza el vacío o el que supera el máximo", () => {
    const ok = validateAnalyticsCollect([{ eventType: "user_registered" }]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.events).toHaveLength(1);

    expect(validateAnalyticsCollect([]).ok).toBe(false);
    const tooBig = Array.from({ length: ANALYTICS_MAX_BATCH + 1 }, () => ({
      eventType: "user_registered" as const,
    }));
    expect(validateAnalyticsCollect(tooBig).ok).toBe(false);
  });
});
