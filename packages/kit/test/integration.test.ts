// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getRedis, redisPrefix } from "../src/redis/index";
import { withRedisLock } from "../src/redis/lock";
import { readStorageEnv } from "../src/env";
import { createStorage } from "../src/storage/index";
import { RedisRateLimitStore } from "../src/rate-limit/redis-store";

// ---------------------------------------------------------------------------
// Integración contra la infra local (`pnpm infra:up`). En CI no hay Redis ni
// MinIO, así que estos bloques se SALTAN si las variables de entorno que los
// configuran no están presentes: los unitarios son los que corren siempre.
//
//   REDIS_URL=redis://:redis_dev_only@localhost:56380 \
//   STORAGE_PROVIDER=s3 STORAGE_BUCKET=escaperoom-assets \
//   STORAGE_REGION=us-east-1 STORAGE_ENDPOINT=http://localhost:9002 \
//   STORAGE_ACCESS_KEY_ID=minioadmin STORAGE_SECRET_ACCESS_KEY=minioadmin \
//     pnpm --filter @escaperoom/kit test
// ---------------------------------------------------------------------------

const hasRedis = Boolean(process.env.REDIS_URL);
const hasStorage = Boolean(
  process.env.STORAGE_ENDPOINT &&
  process.env.STORAGE_BUCKET &&
  process.env.STORAGE_ACCESS_KEY_ID &&
  process.env.STORAGE_SECRET_ACCESS_KEY,
);

describe.skipIf(!hasRedis)("redis (integración con infra local)", () => {
  afterAll(async () => {
    await getRedis()
      ?.quit()
      .catch(() => {});
  });

  it("responde a PING y guarda/lee una clave", async () => {
    const redis = getRedis();
    expect(redis).not.toBeNull();
    await expect(redis!.ping()).resolves.toBe("PONG");

    const key = `${redisPrefix()}:test:${randomUUID()}`;
    await redis!.set(key, "ok", "PX", 5000);
    await expect(redis!.get(key)).resolves.toBe("ok");
    await redis!.del(key);
  });

  it("ejecuta fn bajo lock y libera el lock al terminar", async () => {
    const result = await withRedisLock(`test:${randomUUID()}`, 5000, async () => "done");
    expect(result).toBe("done");
  });

  it("RedisRateLimitStore.hit deja siempre TTL en la clave (E-21: INCR+EXPIRE atómico)", async () => {
    const redis = getRedis()!;
    const store = new RedisRateLimitStore(redis, redisPrefix());
    const key = `test:${randomUUID()}`;
    const redisKey = `${redisPrefix()}:rl:${key}`;

    const first = await store.hit(key, 5, 60);
    expect(first.ok).toBe(true);
    // La clave nunca debe quedar sin TTL entre el INCR y el EXPIRE: si el
    // script no fuera atómico, una inspección justo después del primer hit
    // podría pillarla con TTL -1 (sin expirar nunca).
    await expect(redis.ttl(redisKey)).resolves.toBeGreaterThan(0);

    // Golpes concurrentes: el contador no debe perder incrementos ni la TTL.
    await Promise.all(Array.from({ length: 4 }, () => store.hit(key, 5, 60)));
    await expect(redis.get(redisKey)).resolves.toBe("5");
    await expect(redis.ttl(redisKey)).resolves.toBeGreaterThan(0);

    await redis.del(redisKey);
  });
});

describe.skipIf(!hasStorage)("storage (integración con MinIO local)", () => {
  const storage = createStorage(readStorageEnv());

  it("sube, descarga, firma y borra un objeto", async () => {
    const key = `kit-tests/${randomUUID()}.txt`;
    const body = Buffer.from("hola escaperoom");

    await storage.putObject({ key, body, contentType: "text/plain" });

    const downloaded = await storage.getObjectBuffer(key);
    expect(downloaded.buffer.toString("utf8")).toBe("hola escaperoom");
    expect(downloaded.contentType).toBe("text/plain");

    await expect(storage.getSignedReadUrl(key)).resolves.toMatch(/^https?:\/\//);

    await storage.deleteObject(key);
    await expect(storage.deleteObjectsByPrefix("kit-tests/")).resolves.toBeGreaterThanOrEqual(0);
  });
});
