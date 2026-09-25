import { getRedis } from "@escaperoom/kit/redis";
import type { AudioPreviewCache, CachedAudioPreview } from "./audio-generation";

/**
 * Caché en Redis de la previsualización de audio IA (B-7), por hash de
 * texto+voz. TTL corto (1 h por defecto): es una comodidad para el vaivén de
 * "prueba, ajusta, prueba igual" del creador, no un archivo — el audio real
 * lo genera de nuevo `confirm()`.
 */
const DEFAULT_TTL_SECONDS = 60 * 60;

function redisKey(hash: string): string {
  return `audio-preview-cache:${hash}`;
}

/** Sin `REDIS_URL` (dev sin infra) degrada a "sin caché": nunca bloquea la preview. */
export function createRedisAudioPreviewCache(ttlSeconds = DEFAULT_TTL_SECONDS): AudioPreviewCache {
  return {
    async get(key) {
      const redis = getRedis();
      if (!redis) return null;
      const raw = await redis.get(redisKey(key)).catch(() => null);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { audio: string; contentType: string };
        return { audio: Buffer.from(parsed.audio, "base64"), contentType: parsed.contentType };
      } catch {
        return null;
      }
    },
    async set(key, value: CachedAudioPreview) {
      const redis = getRedis();
      if (!redis) return;
      const payload = JSON.stringify({
        audio: Buffer.from(value.audio).toString("base64"),
        contentType: value.contentType,
      });
      await redis.set(redisKey(key), payload, "EX", ttlSeconds).catch(() => undefined);
    },
  };
}
