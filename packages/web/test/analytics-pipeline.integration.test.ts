// @vitest-environment node
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { closeSharedQueueConnection } from "@escaperoom/kit/queue";
import { createQueueRedis } from "@escaperoom/kit/redis";
import { createAnalyticsQueue, emitAnalyticsEvents } from "@escaperoom/shared/analytics";
import type { PrismaClient } from "@escaperoom/shared/db";
import { createAnalyticsWorker, type AnalyticsEventStore } from "@escaperoom/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnalyticsCollectHandler } from "../src/server/rest/analytics-collect";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Redis ni Postgres, así que se
// salta. En local, con la infra levantada:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   REDIS_URL=redis://:redis_dev_only@localhost:56380 pnpm --filter @escaperoom/web test analytics-pipeline
//
// `DATABASE_URL` se carga de packages/shared/.env (lo escribe pnpm dev:env).
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../../shared/.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const hasInfra = Boolean(process.env.REDIS_URL && process.env.DATABASE_URL);

describe.skipIf(!hasInfra)("pipeline de analítica (integración: Redis + Postgres)", () => {
  let prisma: PrismaClient;
  let connection: ReturnType<typeof createQueueRedis>;
  let queue: ReturnType<typeof createAnalyticsQueue>;
  let worker: ReturnType<typeof createAnalyticsWorker>;
  let POST: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    const db = await import("@escaperoom/shared/db");
    prisma = db.prisma;

    connection = createQueueRedis();
    queue = createAnalyticsQueue({ enabled: true });
    worker = createAnalyticsWorker({
      store: prisma.analyticsEvent as unknown as AnalyticsEventStore,
      connection,
      concurrency: 5,
    });
    await worker.waitUntilReady();

    POST = createAnalyticsCollectHandler({
      emit: (events) => emitAnalyticsEvents(events, queue),
    });
  });

  afterAll(async () => {
    await worker?.close();
    await closeSharedQueueConnection();
    await connection?.quit().catch(() => undefined);
    await prisma?.$disconnect().catch(() => undefined);
  });

  it("un POST de evento de prueba llega a analyticsEvent", async () => {
    const marker = `test-${randomUUID()}`;

    const response = await POST(
      new Request("http://localhost/api/analytics/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: "room_playtest_started",
          playerId: marker,
          payload: { marker },
        }),
      }),
    );

    expect(response.status).toBe(202);

    const row = await waitForEvent(prisma, marker);
    expect(row).not.toBeNull();
    expect(row?.eventType).toBe("room_playtest_started");
  });
});

async function waitForEvent(
  prisma: PrismaClient,
  playerId: string,
  timeoutMs = 5000,
): Promise<{ eventType: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.analyticsEvent.findFirst({
      where: { playerId },
      select: { eventType: true },
    });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}
