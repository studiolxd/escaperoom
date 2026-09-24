import { prisma } from "@escaperoom/shared/db";
import { redisHealth } from "@escaperoom/kit/health";
import { LIST_PARTITIONS_SQL, isNextMonthPartitionMissing } from "@escaperoom/shared/analytics";

/**
 * GET /api/health — liveness de `packages/web` para Uptime Kuma (ticket 6.4,
 * docs/specs/24-operaciones-y-escalabilidad.md §6). Comprueba Postgres (un
 * `SELECT 1` por Prisma) y Redis (reutiliza `redisHealth()` del kit, la misma
 * conexión compartida que usa el rate limiting del ticket 6.3). Ligero a
 * propósito: nada de negocio, solo las dos dependencias de las que depende
 * que la app responda.
 *
 * Sin `REDIS_URL` configurado, Redis se reporta `not_configured` y NO cuenta
 * como caída (degradación sin colas es un estado válido en desarrollo).
 * Postgres es obligatorio: sin conexión, el endpoint responde 503.
 *
 * `analyticsPartitions` (E-6) es solo informativo: no cambia `ok`/el código de
 * estado. Es la señal independiente de que el worker de particiones (E-9)
 * siga vivo — si el worker entero está caído, esta comprobación (que corre
 * aquí, en la web, no en el worker) es la única forma de verlo antes de que
 * empiecen a fallar los INSERT del mes que viene.
 */
export async function GET() {
  const [database, redis, analyticsPartitions] = await Promise.all([
    checkDatabase(),
    redisHealth(),
    checkAnalyticsPartitions(),
  ]);

  const ok = database === "up" && redis !== "down";
  const body = { ok, database, redis, analyticsPartitions, timestamp: new Date().toISOString() };

  return Response.json(body, { status: ok ? 200 : 503 });
}

async function checkDatabase(): Promise<"up" | "down"> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}

async function checkAnalyticsPartitions(): Promise<"ok" | "missing_next_month" | "unknown"> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(LIST_PARTITIONS_SQL);
    return isNextMonthPartitionMissing(
      rows.map((r) => r.name),
      new Date(),
    )
      ? "missing_next_month"
      : "ok";
  } catch {
    return "unknown";
  }
}
