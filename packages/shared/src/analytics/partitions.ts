/**
 * Mantenimiento de las particiones mensuales de `analyticsEvent` (ticket 6.11,
 * specs/14 §8 y §12): crea por adelantado la partición del mes siguiente y purga
 * las que solo contienen datos con más de 24 meses.
 *
 * Todo el cálculo (meses, plan y SQL) es puro y se testea sin base de datos; la
 * ejecución va dentro de una transacción con un advisory lock de Postgres, así
 * que un reintento o dos workers a la vez no se pisan (el segundo se omite).
 *
 * Solo se tocan particiones hijas de `analyticsEvent` cuyo nombre sigue el
 * patrón `analyticsEvent_AAAA_MM`: cualquier otra (p. ej. una DEFAULT creada a
 * mano) se ignora y se reporta, nunca se borra.
 */

export const ANALYTICS_EVENT_TABLE = "analyticsEvent";
/** Retención del detalle de analítica (specs/14 §12). */
export const ANALYTICS_RETENTION_MONTHS = 24;
/**
 * Meses por delante del actual que deben existir (el «mes siguiente»). En 1,
 * un worker caído el día 1 (o cuyo DDL falla por `lock_timeout`) llega al mes
 * siguiente sin partición y cada `INSERT` empieza a fallar (E-6); con 3 hay
 * margen para varios reintentos/varios días de worker caído antes de que
 * ocurra.
 */
export const ANALYTICS_PARTITIONS_AHEAD = 3;
/** Clave del advisory lock (se pasa por `hashtext()` en SQL). */
export const ANALYTICS_PARTITIONS_LOCK_KEY = "escaperoom:analyticsEvent:partitions";
/**
 * Partición DEFAULT (migración `20260924000000_analytics_event_default_partition`,
 * E-6): red de seguridad si, pese a `ANALYTICS_PARTITIONS_AHEAD`, un `INSERT`
 * cae fuera de toda partición mensual — sin DEFAULT ese `INSERT` fallaría con
 * "no partition of relation found for row"; con ella, cae aquí y se puede
 * alertar (`defaultPartitionHasRows`) en vez de perderse el evento.
 */
export const ANALYTICS_DEFAULT_PARTITION_NAME = `${ANALYTICS_EVENT_TABLE}_default`;

/** Mes natural en UTC; `month` va de 1 a 12. */
export type YearMonth = { year: number; month: number };

const PARTITION_NAME_RE = new RegExp(`^${ANALYTICS_EVENT_TABLE}_(\\d{4})_(0[1-9]|1[0-2])$`);

/** Mes (UTC) al que pertenece un instante. */
export function yearMonthOf(date: Date): YearMonth {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Suma (o resta, con `n` negativo) meses naturales, cruzando años. */
export function addMonths(ym: YearMonth, n: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + n;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** `analyticsEvent_2026_09`. */
export function partitionName(ym: YearMonth): string {
  return `${ANALYTICS_EVENT_TABLE}_${pad(ym.year, 4)}_${pad(ym.month, 2)}`;
}

/** Inverso de `partitionName`; `null` si el nombre no es una partición mensual nuestra. */
export function parsePartitionName(name: string): YearMonth | null {
  const match = PARTITION_NAME_RE.exec(name);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** Literal `timestamptz` del primer instante del mes, con zona explícita (UTC). */
export function monthStartLiteral(ym: YearMonth): string {
  return `${pad(ym.year, 4)}-${pad(ym.month, 2)}-01 00:00:00+00`;
}

/** Rango `[from, to)` de la partición de un mes, como en la migración 0008. */
export function partitionBounds(ym: YearMonth): { from: string; to: string } {
  return { from: monthStartLiteral(ym), to: monthStartLiteral(addMonths(ym, 1)) };
}

/**
 * Primer mes que se conserva. Una partición se purga si su mes es anterior: su
 * límite superior (día 1 del mes de corte) es ≤ `now − retentionMonths`, así que
 * todo lo que contiene tiene estrictamente más de `retentionMonths` meses. La
 * partición a caballo del corte se conserva hasta el mes siguiente (se retiene
 * como mucho un mes de más, nunca de menos).
 */
export function retentionCutoff(now: Date, retentionMonths: number): YearMonth {
  return addMonths(yearMonthOf(now), -retentionMonths);
}

export type PartitionPlanInput = {
  now: Date;
  /** Nombres de las particiones hijas existentes de `analyticsEvent`. */
  existing: readonly string[];
  retentionMonths?: number;
  monthsAhead?: number;
};

export type PartitionPlan = {
  /** Meses cuya partición falta (del actual al actual + `monthsAhead`). */
  create: YearMonth[];
  /** Particiones a purgar, de la más antigua a la más reciente. */
  drop: string[];
  /** Particiones hijas que no siguen el patrón mensual: no se tocan. */
  ignored: string[];
  cutoff: YearMonth;
};

export function planPartitionMaintenance(input: PartitionPlanInput): PartitionPlan {
  const retentionMonths = input.retentionMonths ?? ANALYTICS_RETENTION_MONTHS;
  const monthsAhead = input.monthsAhead ?? ANALYTICS_PARTITIONS_AHEAD;
  if (!Number.isInteger(retentionMonths) || retentionMonths < 1) {
    throw new RangeError(`retentionMonths inválido: ${retentionMonths}`);
  }
  if (!Number.isInteger(monthsAhead) || monthsAhead < 0) {
    throw new RangeError(`monthsAhead inválido: ${monthsAhead}`);
  }

  const current = yearMonthOf(input.now);
  const cutoff = retentionCutoff(input.now, retentionMonths);
  const existing = new Set(input.existing);

  const create: YearMonth[] = [];
  for (let i = 0; i <= monthsAhead; i++) {
    const ym = addMonths(current, i);
    if (!existing.has(partitionName(ym))) create.push(ym);
  }

  const dropped: { name: string; ym: YearMonth }[] = [];
  const ignored: string[] = [];
  for (const name of existing) {
    const ym = parsePartitionName(name);
    if (!ym) ignored.push(name);
    else if (compareYearMonth(ym, cutoff) < 0) dropped.push({ name, ym });
  }
  dropped.sort((a, b) => compareYearMonth(a.ym, b.ym));

  return { create, drop: dropped.map((d) => d.name), ignored: ignored.sort(), cutoff };
}

/**
 * `true` si falta la partición del mes siguiente al actual (E-6): señal para
 * `/api/health` — independiente de que el job de mantenimiento haya corrido o
 * no, así que sigue funcionando aunque el worker entero esté caído (justo el
 * escenario que hace falta detectar: "worker caído el día 1 → el mes
 * siguiente cada INSERT falla").
 */
export function isNextMonthPartitionMissing(existing: readonly string[], now: Date): boolean {
  const nextMonth = addMonths(yearMonthOf(now), 1);
  return !existing.includes(partitionName(nextMonth));
}

// --- SQL --------------------------------------------------------------------

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Solo acepta nombres de partición mensual de `analyticsEvent` (defensa ante DDL arbitrario). */
function assertPartitionName(name: string): string {
  if (!parsePartitionName(name)) {
    throw new Error(`no es una partición mensual de ${ANALYTICS_EVENT_TABLE}: ${name}`);
  }
  return quoteIdent(name);
}

/** Toma el lock de la transacción sin esperar; devuelve `locked` (boolean). */
export const TRY_LOCK_SQL = `SELECT pg_try_advisory_xact_lock(hashtext('${ANALYTICS_PARTITIONS_LOCK_KEY}')) AS "locked"`;

/** Que un DDL bloqueado por escrituras en curso falle (y BullMQ reintente) en vez de colgarse. */
export const LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '10s'";

/** Particiones hijas de `analyticsEvent` (en el esquema del `search_path`). */
export const LIST_PARTITIONS_SQL = [
  `SELECT c.relname AS "name"`,
  `FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid`,
  `WHERE i.inhparent = '${quoteIdent(ANALYTICS_EVENT_TABLE)}'::regclass`,
  `ORDER BY c.relname`,
].join(" ");

/** Idempotente: si la partición ya existe no hace nada. */
export function createPartitionSql(ym: YearMonth): string {
  const { from, to } = partitionBounds(ym);
  return (
    `CREATE TABLE IF NOT EXISTS ${quoteIdent(partitionName(ym))} ` +
    `PARTITION OF ${quoteIdent(ANALYTICS_EVENT_TABLE)} ` +
    `FOR VALUES FROM ('${from}') TO ('${to}')`
  );
}

/** DETACH primero: falla si la tabla no es partición de `analyticsEvent`. */
export function detachPartitionSql(name: string): string {
  return `ALTER TABLE ${quoteIdent(ANALYTICS_EVENT_TABLE)} DETACH PARTITION ${assertPartitionName(name)}`;
}

export function dropPartitionSql(name: string): string {
  return `DROP TABLE ${assertPartitionName(name)}`;
}

// --- Ejecución --------------------------------------------------------------

/** Lo mínimo que la ejecución necesita dentro de la transacción. */
export interface PartitionMaintenanceTx {
  query<T>(sql: string): Promise<T[]>;
  execute(sql: string): Promise<void>;
}

/** Abre una transacción (un DDL fallido revierte todo el mantenimiento). */
export interface PartitionMaintenanceDb {
  transaction<T>(fn: (tx: PartitionMaintenanceTx) => Promise<T>): Promise<T>;
}

export type PartitionMaintenanceResult =
  | {
      status: "done";
      created: string[];
      dropped: string[];
      ignored: string[];
      /** Primer mes conservado, `AAAA-MM`. */
      cutoff: string;
      /**
       * `true` si la partición DEFAULT existe y tiene al menos una fila (E-6):
       * significa que algún `INSERT` cayó fuera de las particiones mensuales
       * esperadas — señal de alerta, nunca un estado normal.
       */
      defaultPartitionHasRows: boolean;
    }
  | { status: "locked" };

export type PartitionMaintenanceOptions = {
  now?: Date;
  retentionMonths?: number;
  monthsAhead?: number;
};

/**
 * Una pasada de mantenimiento: lock → listar → crear lo que falta → purgar lo
 * que supera la retención. Si otra pasada tiene el lock, devuelve `locked` sin
 * tocar nada (la otra hará el trabajo; el resultado es el mismo).
 */
export async function maintainAnalyticsPartitions(
  db: PartitionMaintenanceDb,
  opts: PartitionMaintenanceOptions = {},
): Promise<PartitionMaintenanceResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const [lock] = await tx.query<{ locked: boolean }>(TRY_LOCK_SQL);
    if (!lock?.locked) return { status: "locked" } as const;
    await tx.execute(LOCK_TIMEOUT_SQL);

    const rows = await tx.query<{ name: string }>(LIST_PARTITIONS_SQL);
    const plan = planPartitionMaintenance({
      now,
      existing: rows.map((r) => r.name),
      retentionMonths: opts.retentionMonths,
      monthsAhead: opts.monthsAhead,
    });

    for (const ym of plan.create) await tx.execute(createPartitionSql(ym));
    for (const name of plan.drop) {
      await tx.execute(detachPartitionSql(name));
      await tx.execute(dropPartitionSql(name));
    }

    let defaultPartitionHasRows = false;
    if (plan.ignored.includes(ANALYTICS_DEFAULT_PARTITION_NAME)) {
      const [row] = await tx.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM ${quoteIdent(ANALYTICS_DEFAULT_PARTITION_NAME)} LIMIT 1) AS "exists"`,
      );
      defaultPartitionHasRows = row?.exists ?? false;
    }

    return {
      status: "done",
      created: plan.create.map(partitionName),
      dropped: plan.drop,
      ignored: plan.ignored,
      cutoff: `${pad(plan.cutoff.year, 4)}-${pad(plan.cutoff.month, 2)}`,
      defaultPartitionHasRows,
    } as const;
  });
}
