import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/health (ticket 6.4): liveness que sonda Uptime Kuma. Postgres y
 * Redis van mockeados — el comportamiento real de `redisHealth()` ya está
 * cubierto en `packages/kit/test/health.test.ts`.
 */
const deps = vi.hoisted(() => ({
  queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
  redisHealth: vi.fn(async (): Promise<"up" | "down" | "not_configured"> => "not_configured"),
}));

vi.mock("@escaperoom/shared/db", () => ({
  prisma: { $queryRaw: () => deps.queryRaw() },
}));
vi.mock("@escaperoom/kit/health", () => ({ redisHealth: deps.redisHealth }));

import { GET } from "../src/app/api/health/route";

beforeEach(() => {
  deps.queryRaw.mockReset().mockResolvedValue([{ "?column?": 1 }]);
  deps.redisHealth.mockReset().mockResolvedValue("not_configured");
});

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
});
