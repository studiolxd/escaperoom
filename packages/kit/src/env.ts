import { z } from "zod";
import { redisSchema, storageSchema } from "@escaperoom/env/server";

// ---------------------------------------------------------------------------
// Puente entre @escaperoom/env (la definición canónica de las variables) y el
// kit. El kit no re-valida ni re-declara nada: lee los fragmentos que ya viven
// en @escaperoom/env y, cuando necesita los valores, los parsea con ellos.
// ---------------------------------------------------------------------------

export type KitRedisEnv = z.infer<typeof redisSchema>;
export type KitStorageEnv = z.infer<typeof storageSchema>;

/** REDIS_URL / QUEUES_ENABLED con sus defaults, leídos del entorno. */
export function readRedisEnv(
  source: Record<string, string | undefined> = process.env,
): KitRedisEnv {
  return redisSchema.parse(source);
}

/** STORAGE_* con sus defaults, leídos del entorno. */
export function readStorageEnv(
  source: Record<string, string | undefined> = process.env,
): KitStorageEnv {
  return storageSchema.parse(source);
}
