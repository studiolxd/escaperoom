import { prisma } from "@escaperoom/shared/db";
import { redisHealth } from "@escaperoom/kit/health";

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
 */
export async function GET() {
  const [database, redis] = await Promise.all([checkDatabase(), redisHealth()]);

  const ok = database === "up" && redis !== "down";
  const body = { ok, database, redis, timestamp: new Date().toISOString() };

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
