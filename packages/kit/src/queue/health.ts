import type Redis from "ioredis";

/**
 * True only if Redis answers PING within `timeoutMs`. Bounded by an explicit
 * race so a dead-but-not-yet-detected socket (ioredis hasn't seen the RST)
 * can't hang the health check. Never throws.
 */
export async function redisResponds(redis: Redis | null, timeoutMs = 2000): Promise<boolean> {
  if (!redis) return false;
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ping timeout")), timeoutMs),
      ),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}

export type WorkerHealth = {
  ok: boolean;
  workersRunning: boolean;
  shuttingDown: boolean;
};

/**
 * Worker readiness (not bare liveness): healthy only when it is not shutting
 * down, every BullMQ worker is still consuming, and Redis is reachable — so an
 * orchestrator can restart a pod that is alive but no longer doing its job.
 */
export async function computeWorkerHealth(deps: {
  shuttingDown: boolean;
  workersRunning: boolean;
  redis: Redis | null;
  timeoutMs?: number;
}): Promise<WorkerHealth> {
  const redisOk = await redisResponds(deps.redis, deps.timeoutMs);
  return {
    ok: !deps.shuttingDown && deps.workersRunning && redisOk,
    workersRunning: deps.workersRunning,
    shuttingDown: deps.shuttingDown,
  };
}
