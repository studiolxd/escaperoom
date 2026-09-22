// No "server-only" here on purpose: a BullMQ worker running outside Next.js
// may import this module directly. Never import it from a client component
// regardless.
//
// REDIS_URL / REDIS_PREFIX / APP_NAME come from @escaperoom/env (redisSchema)
// and process.env: adoption needs no wiring.
import Redis from "ioredis";
import { readRedisEnv } from "../env";
import { logger } from "../logger";

const globalForRedis = globalThis as unknown as {
  redis?: Redis;
  redisSubscriber?: Redis;
};

function redisUrl(): string | undefined {
  return readRedisEnv().REDIS_URL;
}

/**
 * Shared lazy Redis client, present only when REDIS_URL is configured.
 * Global-cached like the Prisma client so dev HMR doesn't leak connections.
 */
export function getRedis(): Redis | null {
  const url = redisUrl();
  if (!url) return null;
  if (!globalForRedis.redis) {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    // Without a listener ioredis raises "Unhandled error event" on disconnects.
    client.on("error", (err) => {
      logger.warn({ err }, "redis: connection error");
    });
    globalForRedis.redis = client;
  }
  return globalForRedis.redis;
}

/**
 * A NEW connection for BullMQ WORKERS. Workers block on the queue
 * (BRPOPLPUSH), so `maxRetriesPerRequest` MUST be null (a blocking command
 * must never bail). Dedicated, not the shared singleton. Only called with the
 * queues feature on, hence the hard throw.
 */
export function createQueueRedis(): Redis {
  const url = redisUrl();
  if (!url) {
    throw new Error("createQueueRedis requires REDIS_URL (QUEUES_ENABLED=true)");
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
  client.on("error", (err) => {
    logger.warn({ err }, "redis: queue connection error");
  });
  return client;
}

/**
 * A NEW connection for the Queue PRODUCER (enqueue). Unlike workers, producers
 * only issue regular commands, so they must FAIL FAST — bounded retries and no
 * offline queue — otherwise `queue.add()` from a web request hangs (or buffers
 * forever) when Redis is down, blocking the request. enqueue() catches the
 * rejection and degrades to a no-op.
 */
export function createProducerRedis(): Redis {
  const url = redisUrl();
  if (!url) {
    throw new Error("createProducerRedis requires REDIS_URL (QUEUES_ENABLED=true)");
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  client.on("error", (err) => {
    logger.warn({ err }, "redis: producer connection error");
  });
  return client;
}

/**
 * Shared subscriber connection for PSUBSCRIBE fan-out. A Redis connection in
 * subscriber mode can't run regular commands, so it must be a separate
 * singleton from getRedis(). Null when REDIS_URL is unset.
 */
export function getSubscriberRedis(): Redis | null {
  const url = redisUrl();
  if (!url) return null;
  if (!globalForRedis.redisSubscriber) {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    client.on("error", (err) => {
      logger.warn({ err }, "redis: subscriber connection error");
    });
    globalForRedis.redisSubscriber = client;
  }
  return globalForRedis.redisSubscriber;
}

/** Namespace for all keys this app writes — the Redis instance is shared. */
export function redisPrefix(): string {
  return (
    process.env.REDIS_PREFIX ??
    (process.env.APP_NAME ?? "escaperoom")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}
