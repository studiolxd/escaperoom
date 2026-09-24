import { describe, expect, it } from "vitest";
import {
  ANALYTICS_PARTITIONS_AHEAD,
  addMonths,
  createPartitionSql,
  detachPartitionSql,
  dropPartitionSql,
  isNextMonthPartitionMissing,
  maintainAnalyticsPartitions,
  parsePartitionName,
  partitionBounds,
  partitionName,
  planPartitionMaintenance,
  retentionCutoff,
  yearMonthOf,
  type PartitionMaintenanceDb,
} from "../src/analytics";

// ---------------------------------------------------------------------------
// Ticket 6.11 — particiones mensuales de analyticsEvent: cálculo de meses, plan
// (crear el mes siguiente, purgar > 24 meses) y SQL generado, todo sin BD.
// ---------------------------------------------------------------------------

describe("cálculo de meses (UTC)", () => {
  it("toma el mes en UTC, no en la zona local", () => {
    expect(yearMonthOf(new Date("2026-09-30T23:30:00-02:00"))).toEqual({ year: 2026, month: 10 });
    expect(yearMonthOf(new Date("2026-10-01T00:30:00+02:00"))).toEqual({ year: 2026, month: 9 });
  });

  it("suma y resta meses cruzando el cambio de año", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
    expect(addMonths({ year: 2028, month: 1 }, -24)).toEqual({ year: 2026, month: 1 });
    expect(addMonths({ year: 2028, month: 3 }, -27)).toEqual({ year: 2025, month: 12 });
  });

  it("nombra y parsea las particiones como la migración 0008", () => {
    expect(partitionName({ year: 2026, month: 9 })).toBe("analyticsEvent_2026_09");
    expect(parsePartitionName("analyticsEvent_2026_09")).toEqual({ year: 2026, month: 9 });
    for (const name of [
      "analyticsEvent_default",
      "analyticsEvent_2026_13",
      "analyticsEvent_2026_9",
      "progressEvent_2026_09",
      'analyticsEvent_2026_09"; DROP TABLE "user',
    ]) {
      expect(parsePartitionName(name)).toBeNull();
    }
  });

  it("los límites son [día 1 del mes, día 1 del siguiente) en UTC", () => {
    expect(partitionBounds({ year: 2026, month: 12 })).toEqual({
      from: "2026-12-01 00:00:00+00",
      to: "2027-01-01 00:00:00+00",
    });
  });
});

describe("isNextMonthPartitionMissing (E-6, señal para /api/health)", () => {
  it("false si la partición del mes siguiente existe", () => {
    const existing = ["analyticsEvent_2026_09", "analyticsEvent_2026_10"];
    expect(isNextMonthPartitionMissing(existing, new Date("2026-09-15T00:00:00Z"))).toBe(false);
  });

  it("true si falta — el escenario que hace que INSERT empiece a fallar el mes que viene", () => {
    const existing = ["analyticsEvent_2026_09"];
    expect(isNextMonthPartitionMissing(existing, new Date("2026-09-15T00:00:00Z"))).toBe(true);
  });

  it("cruza el año correctamente", () => {
    expect(isNextMonthPartitionMissing(["analyticsEvent_2027_01"], new Date("2026-12-15T00:00:00Z"))).toBe(
      false,
    );
    expect(isNextMonthPartitionMissing([], new Date("2026-12-15T00:00:00Z"))).toBe(true);
  });
});

describe("planPartitionMaintenance — creación", () => {
  it("crea la partición del mes actual y la del siguiente si faltan (monthsAhead: 1)", () => {
    const plan = planPartitionMaintenance({
      now: new Date("2026-11-15T10:00:00Z"),
      existing: [],
      monthsAhead: 1,
    });
    expect(plan.create.map(partitionName)).toEqual([
      "analyticsEvent_2026_11",
      "analyticsEvent_2026_12",
    ]);
  });

  it("no crea nada si ya existen (idempotente)", () => {
    const plan = planPartitionMaintenance({
      now: new Date("2026-09-23T00:00:00Z"),
      existing: [
        "analyticsEvent_2026_09",
        "analyticsEvent_2026_10",
        "analyticsEvent_2026_11",
        "analyticsEvent_2026_12",
      ],
    });
    expect(plan.create).toEqual([]);
    expect(plan.drop).toEqual([]);
  });

  it("en diciembre crea la de enero del año siguiente (monthsAhead: 1)", () => {
    const plan = planPartitionMaintenance({
      now: new Date("2026-12-01T03:00:00Z"),
      existing: ["analyticsEvent_2026_12"],
      monthsAhead: 1,
    });
    expect(plan.create.map(partitionName)).toEqual(["analyticsEvent_2027_01"]);
  });

  it("monthsAhead amplía la ventana creada por adelantado", () => {
    const plan = planPartitionMaintenance({
      now: new Date("2026-09-23T00:00:00Z"),
      existing: ["analyticsEvent_2026_09"],
      monthsAhead: 3,
    });
    expect(plan.create.map(partitionName)).toEqual([
      "analyticsEvent_2026_10",
      "analyticsEvent_2026_11",
      "analyticsEvent_2026_12",
    ]);
  });

  it("por defecto (E-6) crea 3 meses por delante, no solo 1", () => {
    expect(ANALYTICS_PARTITIONS_AHEAD).toBe(3);
    const plan = planPartitionMaintenance({
      now: new Date("2026-09-23T00:00:00Z"),
      existing: ["analyticsEvent_2026_09"],
    });
    expect(plan.create.map(partitionName)).toEqual([
      "analyticsEvent_2026_10",
      "analyticsEvent_2026_11",
      "analyticsEvent_2026_12",
    ]);
  });
});

describe("planPartitionMaintenance — purga a 24 meses", () => {
  const months = (from: string, count: number): string[] => {
    const [y, m] = from.split("-").map(Number);
    return Array.from({ length: count }, (_, i) =>
      partitionName(addMonths({ year: y!, month: m! }, i)),
    );
  };

  it("el primer mes conservado es el actual menos 24", () => {
    expect(retentionCutoff(new Date("2028-09-15T12:00:00Z"), 24)).toEqual({
      year: 2026,
      month: 9,
    });
  });

  it("purga solo los meses anteriores al corte, del más antiguo al más reciente", () => {
    const plan = planPartitionMaintenance({
      now: new Date("2028-09-15T12:00:00Z"),
      existing: months("2026-06", 30).reverse(),
    });
    expect(plan.drop).toEqual([
      "analyticsEvent_2026_06",
      "analyticsEvent_2026_07",
      "analyticsEvent_2026_08",
    ]);
    expect(plan.cutoff).toEqual({ year: 2026, month: 9 });
  });

  it("fecha límite exacta: la partición se purga justo al empezar el mes en que cumple 24", () => {
    const existing = ["analyticsEvent_2026_08", "analyticsEvent_2026_09"];
    // Último instante de agosto de 2028: 2026-08 aún contiene datos de < 24 meses.
    expect(
      planPartitionMaintenance({ now: new Date("2028-08-31T23:59:59.999Z"), existing }).drop,
    ).toEqual([]);
    // 2028-09-01T00:00Z: todo 2026-08 (< 2026-09-01) tiene ya más de 24 meses.
    expect(planPartitionMaintenance({ now: new Date("2028-09-01T00:00:00Z"), existing }).drop).toEqual(
      ["analyticsEvent_2026_08"],
    );
  });

  it("cambio de año: en enero se purga diciembre de hace 25 meses, no enero de hace 24", () => {
    const existing = ["analyticsEvent_2025_11", "analyticsEvent_2025_12", "analyticsEvent_2026_01"];
    expect(planPartitionMaintenance({ now: new Date("2027-12-31T23:59:59Z"), existing }).drop).toEqual(
      ["analyticsEvent_2025_11"],
    );
    expect(planPartitionMaintenance({ now: new Date("2028-01-01T00:00:00Z"), existing }).drop).toEqual(
      ["analyticsEvent_2025_11", "analyticsEvent_2025_12"],
    );
  });

  it("nunca purga particiones con otro nombre (p. ej. una DEFAULT): las reporta", () => {
    const plan = planPartitionMaintenance({
      now: new Date("2030-01-01T00:00:00Z"),
      existing: ["analyticsEvent_default", "analyticsEvent_2020_01"],
    });
    expect(plan.drop).toEqual(["analyticsEvent_2020_01"]);
    expect(plan.ignored).toEqual(["analyticsEvent_default"]);
  });

  it("rechaza una retención inválida en vez de purgar de más", () => {
    for (const retentionMonths of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        planPartitionMaintenance({ now: new Date(), existing: [], retentionMonths }),
      ).toThrow(RangeError);
    }
  });
});

describe("SQL generado", () => {
  it("CREATE idempotente con límites UTC explícitos", () => {
    expect(createPartitionSql({ year: 2026, month: 12 })).toBe(
      `CREATE TABLE IF NOT EXISTS "analyticsEvent_2026_12" PARTITION OF "analyticsEvent" ` +
        `FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00')`,
    );
  });

  it("DETACH + DROP solo de particiones mensuales de analyticsEvent", () => {
    expect(detachPartitionSql("analyticsEvent_2024_08")).toBe(
      `ALTER TABLE "analyticsEvent" DETACH PARTITION "analyticsEvent_2024_08"`,
    );
    expect(dropPartitionSql("analyticsEvent_2024_08")).toBe(`DROP TABLE "analyticsEvent_2024_08"`);
    expect(() => dropPartitionSql("accessKey")).toThrow(/no es una partición/);
    expect(() => detachPartitionSql('analyticsEvent_2024_08"; --')).toThrow(/no es una partición/);
  });
});

/** BD falsa: registra el SQL y simula el advisory lock compartido entre pasadas. */
function fakeDb(existing: string[]) {
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
              // Cede el turno para que una pasada simultánea llegue a pedir el lock.
              await new Promise((r) => setTimeout(r, 5));
              return [{ locked: mine }] as T[];
            }
            return existing.map((name) => ({ name })) as T[];
          },
          async execute(sql: string) {
            executed.push(sql);
          },
        });
      } finally {
        if (mine) lockHeld = false;
      }
    },
  };
  return { db, executed };
}

describe("maintainAnalyticsPartitions", () => {
  it("toma el lock, crea el mes siguiente y purga lo antiguo en orden", async () => {
    const { db, executed } = fakeDb(["analyticsEvent_2026_09", "analyticsEvent_2024_08"]);
    const result = await maintainAnalyticsPartitions(db, {
      now: new Date("2026-09-23T00:00:00Z"),
      monthsAhead: 1,
    });
    expect(result).toEqual({
      status: "done",
      created: ["analyticsEvent_2026_10"],
      dropped: ["analyticsEvent_2024_08"],
      ignored: [],
      cutoff: "2024-09",
      defaultPartitionHasRows: false,
    });
    expect(executed).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      createPartitionSql({ year: 2026, month: 10 }),
      detachPartitionSql("analyticsEvent_2024_08"),
      dropPartitionSql("analyticsEvent_2024_08"),
    ]);
  });

  it("dos ejecuciones simultáneas no se pisan: la segunda se omite sin tocar nada", async () => {
    const { db, executed } = fakeDb(["analyticsEvent_2024_08"]);
    const now = new Date("2026-09-23T00:00:00Z");
    const results = await Promise.all([
      maintainAnalyticsPartitions(db, { now, monthsAhead: 1 }),
      maintainAnalyticsPartitions(db, { now, monthsAhead: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["done", "locked"]);
    expect(executed.filter((s) => s.startsWith("DROP"))).toHaveLength(1);
    expect(executed.filter((s) => s.startsWith("CREATE"))).toHaveLength(2);
  });

  it("propaga el error de un DDL para que BullMQ reintente", async () => {
    const db: PartitionMaintenanceDb = {
      transaction: (fn) =>
        fn({
          query: async <T>(sql: string) =>
            (sql.includes("advisory") ? [{ locked: true }] : []) as T[],
          execute: async (sql) => {
            if (sql.startsWith("CREATE")) throw new Error("lock timeout");
          },
        }),
    };
    await expect(maintainAnalyticsPartitions(db)).rejects.toThrow("lock timeout");
  });

  it("E-6: si la partición DEFAULT existe y tiene filas, lo reporta en defaultPartitionHasRows", async () => {
    const existing = ["analyticsEvent_2026_09", "analyticsEvent_default"];
    const db: PartitionMaintenanceDb = {
      transaction: (fn) =>
        fn({
          query: async <T>(sql: string) => {
            if (sql.includes("advisory")) return [{ locked: true }] as T[];
            if (sql.includes("EXISTS")) return [{ exists: true }] as T[];
            return existing.map((name) => ({ name })) as T[];
          },
          execute: async () => {},
        }),
    };
    const result = await maintainAnalyticsPartitions(db, {
      now: new Date("2026-09-23T00:00:00Z"),
      monthsAhead: 1,
    });
    expect(result).toMatchObject({ status: "done", ignored: ["analyticsEvent_default"] });
    if (result.status === "done") expect(result.defaultPartitionHasRows).toBe(true);
  });

  it("E-6: si la partición DEFAULT existe pero está vacía, no alerta", async () => {
    const existing = ["analyticsEvent_2026_09", "analyticsEvent_default"];
    const db: PartitionMaintenanceDb = {
      transaction: (fn) =>
        fn({
          query: async <T>(sql: string) => {
            if (sql.includes("advisory")) return [{ locked: true }] as T[];
            if (sql.includes("EXISTS")) return [{ exists: false }] as T[];
            return existing.map((name) => ({ name })) as T[];
          },
          execute: async () => {},
        }),
    };
    const result = await maintainAnalyticsPartitions(db, {
      now: new Date("2026-09-23T00:00:00Z"),
      monthsAhead: 1,
    });
    if (result.status === "done") expect(result.defaultPartitionHasRows).toBe(false);
  });
});
