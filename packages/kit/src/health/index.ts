import type Redis from "ioredis";
import { logger } from "../logger";
import { getRedis } from "../redis";
import { computeWorkerHealth, type WorkerHealth } from "../queue/health";

// ---------------------------------------------------------------------------
// Health de procesos que no exponen la app Next (workers de colas, el servidor
// Colyseus, el mcp-server). Es un handler de liveness/readiness, no la ruta de
// salud de la web: responde con el estado y un 200/503, y no depende de
// Prisma. Adaptado de @slxd/kit/routes/health y del `/healthz` del worker
// (ADR-017).
// ---------------------------------------------------------------------------

export type WorkerHealthDeps = {
  /** Proceso cerrándose: deja de aceptar tráfico (falla el readiness). */
  shuttingDown: () => boolean;
  /** Los consumidores siguen vivos (p. ej. `workers.every((w) => w.isRunning())`). */
  workersRunning: () => boolean;
  /**
   * Cliente Redis a sondear. Opcional: sin él, la sonda de Redis queda fuera
   * del veredicto (útil para un proceso sin colas).
   */
  redis?: () => Redis | null;
  /** Timeout del PING en ms (default 2000). */
  timeoutMs?: number;
};

/**
 * Construye la comprobación de salud. Reutiliza `computeWorkerHealth`; con
 * `redis` ausente, se considera que Redis no aporta al veredicto.
 */
export function createWorkerHealthCheck(deps: WorkerHealthDeps) {
  return async function check(): Promise<WorkerHealth> {
    const redis = deps.redis ? deps.redis() : null;
    if (!deps.redis) {
      // Sin sonda de Redis el worker es "sano" si no se está cerrando y sus
      // consumidores siguen vivos.
      return {
        ok: !deps.shuttingDown() && deps.workersRunning(),
        workersRunning: deps.workersRunning(),
        shuttingDown: deps.shuttingDown(),
      };
    }
    return computeWorkerHealth({
      shuttingDown: deps.shuttingDown(),
      workersRunning: deps.workersRunning(),
      redis,
      timeoutMs: deps.timeoutMs,
    });
  };
}

/**
 * Handler de liveness para montar en un `http.createServer` (o equivalente).
 * Solo atiende `GET`; devuelve 200 cuando el worker está sano y 503 cuando no,
 * con el detalle en JSON. Nunca lanza: un fallo de sonda es un 503, no un 500.
 */
export function createWorkerHealthHandler(
  deps: WorkerHealthDeps,
): (request: Request) => Promise<Response> {
  const check = createWorkerHealthCheck(deps);
  return async function handler(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response(null, { status: 404 });
    }
    let status: WorkerHealth;
    try {
      status = await check();
    } catch (err) {
      logger.warn({ err }, "health: worker probe failed");
      return Response.json(
        { ok: false, workersRunning: false, shuttingDown: deps.shuttingDown() },
        { status: 503 },
      );
    }
    return Response.json(status, { status: status.ok ? 200 : 503 });
  };
}

/** Sonda de Redis reutilizable por otras rutas de salud. */
export async function redisHealth(): Promise<"up" | "down" | "not_configured"> {
  const redis = getRedis();
  if (!redis) return "not_configured";
  try {
    await redis.ping();
    return "up";
  } catch {
    return "down";
  }
}
