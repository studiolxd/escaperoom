// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getRedis, redisPrefix } from "../src/redis/index";
import { readStorageEnv } from "../src/env";
import { createStorage } from "../src/storage/index";
import { RedisRateLimitStore } from "../src/rate-limit/redis-store";

// ---------------------------------------------------------------------------
// Integración contra la infra local (`pnpm infra:up`). En CI, Redis y
// SeaweedFS se levantan como servicios del job `verify`, así que estos
// bloques corren ahí también; fuera de CI se SALTAN si las variables de
// entorno que los configuran no están presentes: los unitarios son los que
// corren siempre.
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

describe.skipIf(!hasStorage)("storage (integración con SeaweedFS local)", () => {
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

  it("sube por PUT presignado, lee cabecera y rango, copia y calcula el digest", async () => {
    const key = `kit-tests/${randomUUID()}.bin`;
    const copyKey = `kit-tests/${randomUUID()}-copia.bin`;
    const bytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3]);

    const { url, headers } = await storage.getSignedUploadUrl(key, {
      contentType: "video/mp4",
      contentLength: bytes.byteLength,
    });
    const put = await fetch(url, { method: "PUT", headers, body: bytes });
    expect(put.ok).toBe(true);

    await expect(storage.headObject(key)).resolves.toEqual({
      contentLength: bytes.byteLength,
      contentType: "video/mp4",
    });
    await expect(storage.getObjectRange(key, 4, 7)).resolves.toEqual(bytes.slice(4, 8));

    await storage.copyObject({ fromKey: key, toKey: copyKey, contentType: "video/mp4" });
    const { createHash } = await import("node:crypto");
    await expect(storage.digestObject(copyKey)).resolves.toEqual({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
      contentType: "video/mp4",
    });

    await storage.deleteObject(key);
    await storage.deleteObject(copyKey);
    await expect(storage.headObject(key)).resolves.toBeNull();
  });
});
