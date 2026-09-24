import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/health (ticket 6.4): liveness que sonda Uptime Kuma. Postgres y
 * Redis van mockeados — el comportamiento real de `redisHealth()` ya está
 * cubierto en `packages/kit/test/health.test.ts`.
 */
const deps = vi.hoisted(() => ({
  queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
  queryRawUnsafe: vi.fn(async (): Promise<{ name: string }[]> => [
    { name: "analyticsEvent_2026_09" },
    { name: "analyticsEvent_2026_10" },
  ]),
  redisHealth: vi.fn(async (): Promise<"up" | "down" | "not_configured"> => "not_configured"),
}));

vi.mock("@escaperoom/shared/db", () => ({
  prisma: { $queryRaw: () => deps.queryRaw(), $queryRawUnsafe: () => deps.queryRawUnsafe() },
}));
vi.mock("@escaperoom/kit/health", () => ({ redisHealth: deps.redisHealth }));

import { GET } from "../src/app/api/health/route";

beforeEach(() => {
  // Fija "ahora" (E-6): checkAnalyticsPartitions() usa `new Date()` real, así
  // que sin fijarla el test dependería del mes en que se ejecuta.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
  deps.queryRaw.mockReset().mockResolvedValue([{ "?column?": 1 }]);
  deps.queryRawUnsafe
    .mockReset()
    .mockResolvedValue([{ name: "analyticsEvent_2026_09" }, { name: "analyticsEvent_2026_10" }]);
  deps.redisHealth.mockReset().mockResolvedValue("not_configured");
});

afterEach(() => vi.useRealTimers());

describe("GET /api/health", () => {
  it("responde 200 cuando Postgres está arriba y Redis no está configurado", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, database: "up", redis: "not_configured" });
  });

  it("responde 200 cuando Postgres y Redis están arriba", async () => {
    deps.redisHealth.mockResolvedValue("up");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("responde 503 cuando Postgres no responde", async () => {
    deps.queryRaw.mockRejectedValue(new Error("Can't reach database server"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, database: "down" });
  });

  it("responde 503 cuando Redis está caído", async () => {
    deps.redisHealth.mockResolvedValue("down");
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });

  it("analyticsPartitions: 'ok' cuando existe la partición del mes siguiente (E-6)", async () => {
    const res = await GET();
    expect((await res.json()).analyticsPartitions).toBe("ok");
  });

  it("analyticsPartitions: 'missing_next_month' sin tumbar el healthcheck (E-6, informativo)", async () => {
    deps.queryRawUnsafe.mockResolvedValue([{ name: "analyticsEvent_2026_09" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, analyticsPartitions: "missing_next_month" });
  });

  it("analyticsPartitions: 'unknown' si la consulta falla, sin tumbar el healthcheck", async () => {
    deps.queryRawUnsafe.mockRejectedValue(new Error("relation does not exist"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).analyticsPartitions).toBe("unknown");
  });
});
