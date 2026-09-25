import { getRedis } from "@escaperoom/kit/redis";

/**
 * Presupuesto diario de tokens del chat del creador, por usuario (B-6): los
 * topes de `CreatorChatLimits` son por conversación, así que sin esto una
 * cuenta abre conversaciones nuevas sin límite y multiplica su coste.
 * Persistido (Redis), no en memoria del proceso: sobrevive a un reinicio y es
 * el mismo contador en todas las instancias.
 */
export interface CreatorChatDailyBudget {
  /** Tokens ya consumidos hoy (UTC) por `userId`. */
  consumed(userId: string): Promise<number>;
  /** Suma `tokens` al contador de hoy de `userId`. */
  add(userId: string, tokens: number): Promise<void>;
}

/** Días naturales UTC, no ventanas de 24 h: reinicia a medianoche, no "hace 24 h desde el primer mensaje". */
function dayKey(userId: string, now: Date): string {
  return `creator-chat:daily-tokens:${userId}:${now.toISOString().slice(0, 10)}`;
}

/** Un poco más de 24 h de margen para que el reloj de Redis nunca expire la clave antes de tiempo. */
const KEY_TTL_SECONDS = 26 * 60 * 60;

/**
 * Store en Redis. Sin `REDIS_URL` (dev sin infra) degrada a "sin presupuesto":
 * `consumed` siempre 0, `add` no-op — igual que el resto del rate limiting del
 * repo sin Redis configurado.
 */
export function createRedisCreatorChatDailyBudget(
  now: () => Date = () => new Date(),
): CreatorChatDailyBudget {
  return {
    async consumed(userId) {
      const redis = getRedis();
      if (!redis) return 0;
      const raw = await redis.get(dayKey(userId, now()));
      return raw ? Number(raw) : 0;
    },
    async add(userId, tokens) {
      if (tokens <= 0) return;
      const redis = getRedis();
      if (!redis) return;
      const key = dayKey(userId, now());
      await redis.incrby(key, tokens);
      await redis.expire(key, KEY_TTL_SECONDS);
    },
  };
}

/** En memoria, para tests: mismo contrato sin Redis. */
export function createInMemoryCreatorChatDailyBudget(
  now: () => Date = () => new Date(),
): CreatorChatDailyBudget {
  const counters = new Map<string, number>();
  return {
    async consumed(userId) {
      return counters.get(dayKey(userId, now())) ?? 0;
    },
    async add(userId, tokens) {
      if (tokens <= 0) return;
      const key = dayKey(userId, now());
      counters.set(key, (counters.get(key) ?? 0) + tokens);
    },
  };
}
