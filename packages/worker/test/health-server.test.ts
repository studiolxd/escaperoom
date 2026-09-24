// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startWorkerHealthServer } from "../src/health-server";

vi.mock("@escaperoom/kit/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("startWorkerHealthServer", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("no arranca nada sin WORKER_HEALTH_PORT (E-9: opcional)", () => {
    vi.stubEnv("WORKER_HEALTH_PORT", undefined);
    const server = startWorkerHealthServer({ shuttingDown: () => false, workersRunning: () => true });
    expect(server).toBeNull();
  });

  it("responde 200 en /healthz cuando el worker está sano", async () => {
    vi.stubEnv("WORKER_HEALTH_PORT", "18965");
    const server = startWorkerHealthServer({ shuttingDown: () => false, workersRunning: () => true });
    expect(server).not.toBeNull();
    try {
      await new Promise((resolve) => server!.once("listening", resolve));
      const res = await fetch("http://127.0.0.1:18965/healthz");
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ ok: true, workersRunning: true });
    } finally {
      await new Promise((resolve) => server!.close(resolve));
    }
  });

  it("responde 503 mientras se está apagando", async () => {
    vi.stubEnv("WORKER_HEALTH_PORT", "18966");
    const server = startWorkerHealthServer({ shuttingDown: () => true, workersRunning: () => true });
    try {
      await new Promise((resolve) => server!.once("listening", resolve));
      const res = await fetch("http://127.0.0.1:18966/healthz");
      expect(res.status).toBe(503);
    } finally {
      await new Promise((resolve) => server!.close(resolve));
    }
  });
});
