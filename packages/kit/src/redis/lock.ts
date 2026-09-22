import { randomUUID } from "node:crypto";
import { logger } from "../logger";
import { getRedis, redisPrefix } from "./index";

// Compare-and-delete: only the holder's token may release the lock, so a run
// that outlives its TTL can't delete a lock someone else has since acquired.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export type LockSkipped = { skipped: "locked" };

/**
 * Runs `fn` under a best-effort distributed lock (SET NX PX). Returns
 * `{ skipped: "locked" }` when another holder owns the lock. Without Redis
 * (REDIS_URL unset) it runs `fn` directly — single-instance deploys need no
 * lock. Redis errors also fail open: a flaky Redis must not stop maintenance
 * from running at all.
 */
export async function withRedisLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | LockSkipped> {
  const redis = getRedis();
  if (!redis) return fn();

  const lockKey = `${redisPrefix()}:lock:${key}`;
  // node:crypto's randomUUID, not Math.random/Date.now — tests may fake those.
  const token = randomUUID();

  let acquired: string | null;
  try {
    acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
  } catch (err) {
    logger.warn({ err, key }, "redis lock: acquire failed, running unlocked");
    return fn();
  }
  if (acquired !== "OK") return { skipped: "locked" };

  try {
    return await fn();
  } finally {
    try {
      await redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
    } catch (err) {
      logger.warn({ err, key }, "redis lock: release failed (expires via TTL)");
    }
  }
}
