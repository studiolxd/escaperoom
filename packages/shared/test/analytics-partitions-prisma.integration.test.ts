import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/client";
import {
  ANALYTICS_PARTITIONS_LOCK_KEY,
  createPartitionSql,
  createPrismaPartitionMaintenanceDb,
  maintainAnalyticsPartitions,
} from "../src/analytics";

// ---------------------------------------------------------------------------
// Integración GATEADA por entorno: en CI no hay Postgres, así que se salta. En
// local, con la infra levantada y las migraciones aplicadas:
//
//   pnpm infra:up && pnpm dev:env && pnpm db:reset
//   pnpm --filter @escaperoom/shared test analytics-partitions-prisma
//
// Ejecuta el mantenimiento real (lock, CREATE … PARTITION OF, DETACH + DROP)
// sobre la base del worktree. Para no tocar las particiones reales (2026_09,
// 2026_10) trabaja con meses lejanos: 2001 para la purga y 2040 para la
// creación, y en `afterAll` borra solo las tablas que ha creado.
// ---------------------------------------------------------------------------

const sharedEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(sharedEnv)) process.loadEnvFile(sharedEnv);

const TEST_PARTITIONS = [
  "analyticsEvent_2001_01",
  "analyticsEvent_2001_02",
  "analyticsEvent_2003_02",
  "analyticsEvent_2003_03",
  "analyticsEvent_2003_04",
  "analyticsEvent_2039_11",
  "analyticsEvent_2039_12",
  "analyticsEvent_2040_01",
  "analyticsEvent_2040_02",
];

describe.skipIf(!process.env.DATABASE_URL)(
  "particiones de analyticsEvent sobre Postgres (integración)",
  () => {
    let prisma: PrismaClient;

    const partitions = async (): Promise<string[]> => {
      const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT c.relname AS "name" FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
         WHERE i.inhparent = '"analyticsEvent"'::regclass ORDER BY c.relname`,
      );
      return rows.map((r) => r.name);
    };
    const dropTestPartitions = async () => {
      for (const name of TEST_PARTITIONS) {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${name}"`);
      }
    };

    beforeAll(async () => {
      prisma = new PrismaClient();
      await dropTestPartitions();
    });

    afterAll(async () => {
      await dropTestPartitions();
      await prisma.$disconnect();
    });

    it("crea la partición del mes actual y la del siguiente, y repetir no falla", async () => {
      const db = createPrismaPartitionMaintenanceDb(prisma);
      // Retención enorme: en esta pasada no se purga nada real.
      const opts = { now: new Date("2040-01-15T10:00:00Z"), retentionMonths: 1200 };

      const first = await maintainAnalyticsPartitions(db, opts);
      expect(first).toMatchObject({
        status: "done",
        created: ["analyticsEvent_2040_01", "analyticsEvent_2040_02"],
        dropped: [],
      });
      const second = await maintainAnalyticsPartitions(db, opts);
      expect(second).toMatchObject({ status: "done", created: [], dropped: [] });

      // La partición creada recibe filas de su mes y hereda los índices del padre.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "analyticsEvent" ("createdAt", "eventType") VALUES ('2040-02-29T23:59:59Z', 'it611')`,
      );
      const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "analyticsEvent_2040_02" WHERE "eventType" = 'it611'`,
      );
      expect(Number(row!.n)).toBe(1);
    });

    it("no falla si la partición del mes siguiente ya existe (creada a mano)", async () => {
      await prisma.$executeRawUnsafe(createPartitionSql({ year: 2039, month: 12 }));
      const result = await maintainAnalyticsPartitions(createPrismaPartitionMaintenanceDb(prisma), {
        now: new Date("2039-11-30T00:00:00Z"),
        retentionMonths: 1200,
        monthsAhead: 1,
      });
      expect(result).toMatchObject({ status: "done", dropped: [] });
      if (result.status === "done") expect(result.created).toEqual(["analyticsEvent_2039_11"]);
    });

    it("purga solo las particiones con más de 24 meses, con su contenido", async () => {
      for (const month of [1, 2]) {
        await prisma.$executeRawUnsafe(createPartitionSql({ year: 2001, month }));
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO "analyticsEvent" ("createdAt", "eventType") VALUES
           ('2001-01-31T23:59:59Z', 'it611'), ('2001-02-01T00:00:00Z', 'it611')`,
      );

      // Corte 2001-02: se va enero de 2001; febrero de 2001 y todo lo real se queda.
      const before = await partitions();
      const result = await maintainAnalyticsPartitions(createPrismaPartitionMaintenanceDb(prisma), {
        now: new Date("2003-02-01T00:00:00Z"),
      });
      expect(result).toMatchObject({
        status: "done",
        dropped: ["analyticsEvent_2001_01"],
        cutoff: "2001-02",
      });

      const after = await partitions();
      expect(after).not.toContain("analyticsEvent_2001_01");
      expect(after).toContain("analyticsEvent_2001_02");
      for (const name of before.filter((n) => n !== "analyticsEvent_2001_01")) {
        expect(after).toContain(name);
      }
      const rows = await prisma.$queryRawUnsafe<{ createdAt: Date }[]>(
        `SELECT "createdAt" FROM "analyticsEvent" WHERE "createdAt" < '2002-01-01' AND "eventType" = 'it611'`,
      );
      expect(rows.map((r) => r.createdAt.toISOString())).toEqual(["2001-02-01T00:00:00.000Z"]);
      // Ni queda suelta como tabla independiente tras el DETACH.
      const [orphan] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM pg_class WHERE relname = 'analyticsEvent_2001_01'`,
      );
      expect(Number(orphan!.n)).toBe(0);
    });

    it("con el lock tomado por otra pasada, se omite sin tocar nada", async () => {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let acquired!: () => void;
      const isAcquired = new Promise<void>((r) => (acquired = r));

      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(
            `SELECT pg_advisory_xact_lock(hashtext('${ANALYTICS_PARTITIONS_LOCK_KEY}'))::text`,
          );
          acquired();
          await held;
        },
        { timeout: 20_000 },
      );
      await isAcquired;

      const before = await partitions();
      const result = await maintainAnalyticsPartitions(createPrismaPartitionMaintenanceDb(prisma), {
        now: new Date("2003-03-10T00:00:00Z"),
      });
      expect(result).toEqual({ status: "locked" });
      expect(await partitions()).toEqual(before);

      release();
      await holder;
    });

    it("dos ejecuciones simultáneas no se pisan: resultado único y sin errores", async () => {
      const db = createPrismaPartitionMaintenanceDb(prisma);
      const now = new Date("2003-03-10T00:00:00Z"); // corte 2001-03 → purga 2001_02
      const results = await Promise.all([
        maintainAnalyticsPartitions(db, { now }),
        maintainAnalyticsPartitions(db, { now }),
      ]);

      const done = results.filter((r) => r.status === "done");
      expect(done.length).toBeGreaterThanOrEqual(1);
      const dropped = done.flatMap((r) => (r.status === "done" ? r.dropped : []));
      const created = done.flatMap((r) => (r.status === "done" ? r.created : []));
      expect(dropped).toEqual(["analyticsEvent_2001_02"]);
      // 2003_03 ya la creó la pasada anterior: solo falta la del mes siguiente.
      expect(created).toEqual(["analyticsEvent_2003_04"]);
    });
  },
);
