import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { logger } from "@escaperoom/kit/logger";
import { purgeExpiredMcpOAuthRows, type McpOAuthPurgeStore } from "@escaperoom/shared/services";
import { createScheduledWorker } from "./scheduled-worker";

/**
 * Job de purga del OAuth del MCP (A-15, ticket 4.7): borra de `verification`
 * las filas `mcp-oauth:*` (códigos, access/refresh tokens, marcas de refresh
 * usado y de grant revocado) ya caducadas. Nada las purga hoy: crecen sin
 * límite en la misma tabla que los magic links y el resto de Better Auth.
 * Cada pasada es idempotente (`DELETE ... WHERE expiresAt < now()`), así que
 * solaparse o repetir una pasada es inocuo.
 */

export const MCP_OAUTH_PURGE_QUEUE_NAME = "retention.mcp-oauth-purge";
/** Id estable del scheduler: reiniciar el worker no duplica la repetición. */
export const MCP_OAUTH_PURGE_SCHEDULER_ID = "mcp-oauth-purge-sweep";
/** Cada hora basta: el token de vida más corta (el código) dura minutos. */
export const DEFAULT_MCP_OAUTH_PURGE_EVERY_MS = 3_600_000;

/** Una pasada del job; registra cuántas filas borró. */
export async function processMcpOAuthPurge(
  store: McpOAuthPurgeStore,
  now: Date = new Date(),
): Promise<number> {
  const deleted = await purgeExpiredMcpOAuthRows(store, now);
  if (deleted > 0) {
    logger.info({ deleted }, "mcp-oauth purge: filas caducadas borradas de verification");
  }
  return deleted;
}

export type McpOAuthPurgeWorkerOptions = {
  store: McpOAuthPurgeStore;
  /** Conexión dedicada de worker (`createQueueRedis()`); bloquea en BRPOPLPUSH. */
  connection: Redis;
  everyMs?: number;
};

/**
 * Crea el `Worker` y registra (o actualiza) el scheduler repetitivo. Devuelve
 * ambos para que el arranque los cierre en el apagado.
 */
export async function createMcpOAuthPurgeWorker(
  opts: McpOAuthPurgeWorkerOptions,
): Promise<{ worker: Worker; queue: Queue }> {
  return createScheduledWorker({
    name: "mcp-oauth purge",
    schedulerId: MCP_OAUTH_PURGE_SCHEDULER_ID,
    jobName: "sweep",
    repeat: { every: opts.everyMs ?? DEFAULT_MCP_OAUTH_PURGE_EVERY_MS },
    connection: opts.connection,
    queueName: MCP_OAUTH_PURGE_QUEUE_NAME,
    process: () => processMcpOAuthPurge(opts.store),
  });
}
