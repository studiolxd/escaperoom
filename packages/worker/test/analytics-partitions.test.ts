// @vitest-environment node
import { randomUUID } from "node:crypto";
import { QueueEvents } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asBullConnection, queuePrefix } from "@escaperoom/kit/queue";
import { createQueueRedis } from "@escaperoom/kit/redis";
import type { PartitionMaintenanceDb } from "@escaperoom/shared/analytics";
import {
  ANALYTICS_PARTITIONS_SCHEDULER_ID,
  DEFAULT_ANALYTICS_PARTITIONS_CRON,
  createAnalyticsPartitionsWorker,
  processAnalyticsPartitions,
} from "../src/analytics-partitions";

/** BD falsa con particiones en memoria y advisory lock compartido. */
function memoryDb(initial: string[]) {
  const partitions = new Set(initial);
  const executed: string[] = [];
  let lockHeld = false;
  const db: PartitionMaintenanceDb = {
    async transaction(fn) {
      let mine = false;
      try {
        return await fn({
          async query<T>(sql: string) {
            if (sql.includes("pg_try_advisory_xact_lock")) {
              mine = !lockHeld;
              lockHeld = true;
              await new Promise((r) => setTimeout(r, 5));
              return [{ locked: mine }] as T[];
            }
            return [...partitions].map((name) => ({ name })) as T[];
          },
          async execute(sql: string) {
            executed.push(sql);
            const create = /^CREATE TABLE IF NOT EXISTS "([^"]+)"/.exec(sql);
            if (create) partitions.add(create[1]!);
            const drop = /^DROP TABLE "([^"]+)"/.exec(sql);
            if (drop) partitions.delete(drop[1]!);
          },
        });
      } finally {
        if (mine) lockHeld = false;
      }
    },
  };
  return { db, partitions, executed };
}

describe("processAnalyticsPartitions", () => {
  it("crea la partición del mes siguiente y purga lo que supera 24 meses", async () => {
    const { db, partitions } = memoryDb([
      "analyticsEvent_2026_08",
      "analyticsEvent_2026_09",
      "analyticsEvent_2028_09",
    ]);
    const result = await processAnalyticsPartitions(db, { now: new Date("2028-09-01T03:00:00Z") });
    expect(result).toMatchObject({
      status: "done",
      created: ["analyticsEvent_2028_10"],
      dropped: ["analyticsEvent_2026_08"],
      cutoff: "2026-09",
    });
    expect([...partitions].sort()).toEqual([
      "analyticsEvent_2026_09",
      "analyticsEvent_2028_09",
      "analyticsEvent_2028_10",
    ]);
  });

  it("un reintento tras una pasada completa no hace nada", async () => {
    const { db, executed } = memoryDb(["analyticsEvent_2026_08"]);
    const now = new Date("2028-09-01T03:00:00Z");
    await processAnalyticsPartitions(db, { now });
    const ddl = executed.length;
    const retry = await processAnalyticsPartitions(db, { now });
    expect(retry).toMatchObject({ status: "done", created: [], dropped: [] });
    expect(executed.slice(ddl).filter((s) => !s.startsWith("SET"))).toEqual([]);
  });

  it("dos pasadas simultáneas: una trabaja y la otra se omite", async () => {
    const { db, executed } = memoryDb(["analyticsEvent_2026_08"]);
    const now = new Date("2028-09-01T03:00:00Z");
    const results = await Promise.all([
      processAnalyticsPartitions(db, { now }),
      processAnalyticsPartitions(db, { now }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["done", "locked"]);
    expect(executed.filter((s) => s.startsWith("DROP"))).toEqual([
      'DROP TABLE "analyticsEvent_2026_08"',
    ]);
  });

  it("el scheduler por defecto corre el día 1 de cada mes", () => {
    expect(DEFAULT_ANALYTICS_PARTITIONS_CRON).toBe("0 3 1 * *");
  });
});

// ---------------------------------------------------------------------------
// Integración GATEADA: BullMQ real contra Redis (en CI no hay Redis y se salta).
//   REDIS_URL=redis://:redis_dev_only@localhost:56380 pnpm --filter @escaperoom/worker test
// ---------------------------------------------------------------------------
const hasRedis = Boolean(process.env.REDIS_URL);

describe.skipIf(!hasRedis)("job de particiones (integración: BullMQ + Redis)", () => {
  const queueName = `analytics.partitions.test-${randomUUID()}`;
  const connections: ReturnType<typeof createQueueRedis>[] = [];
  let events: QueueEvents;

  beforeAll(async () => {
    events = new QueueEvents(queueName, {
      connection: asBullConnection(createQueueRedis()),
      prefix: queuePrefix(),
    });
    await events.waitUntilReady();
  });

  afterAll(async () => {
    await events?.close();
    for (const c of connections) await c.quit().catch(() => undefined);
  });

  it("dos workers arrancando a la vez: un solo scheduler y una sola pasada de arranque", async () => {
    const { db } = memoryDb(["analyticsEvent_2026_08"]);
    const now = () => new Date("2028-09-01T03:00:00Z");
    let passes = 0;
    const sharedDb: PartitionMaintenanceDb = {
      transaction: (fn) => {
        passes++;
        return db.transaction(fn);
      },
    };
    const conn = () => {
      const c = createQueueRedis();
      connections.push(c);
      return c;
    };

    const completed = new Promise<void>((resolve) => events.on("completed", () => resolve()));
    const [a, b] = await Promise.all([
      createAnalyticsPartitionsWorker({ db: sharedDb, connection: conn(), queueName, now }),
      createAnalyticsPartitionsWorker({ db: sharedDb, connection: conn(), queueName, now }),
    ]);
    try {
      await completed;
      await new Promise((r) => setTimeout(r, 300));
      const schedulers = await a.queue.getJobSchedulers();
      expect(schedulers.map((s) => s.key)).toEqual([ANALYTICS_PARTITIONS_SCHEDULER_ID]);
      expect(schedulers[0]).toMatchObject({ pattern: DEFAULT_ANALYTICS_PARTITIONS_CRON, tz: "UTC" });
      expect(passes).toBe(1);
      expect(await a.queue.getJob("boot-2028-09-01")).toBeDefined();
    } finally {
      await a.worker.close();
      await b.worker.close();
      await a.queue.obliterate({ force: true }).catch(() => undefined);
      await a.queue.close();
      await b.queue.close();
    }
  });
});
