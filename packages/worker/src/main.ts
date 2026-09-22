import { existsSync } from "node:fs";
import { createQueueRedis } from "@escaperoom/kit/redis";
import { logger } from "@escaperoom/kit/logger";
import { prisma } from "@escaperoom/shared/db";
import { createAnalyticsWorker, type AnalyticsEventStore } from "./worker";

/**
 * Arranque del worker de analítica.
 *
 *   pnpm --filter @escaperoom/worker dev
 *
 * Carga `packages/shared/.env` (lo escribe `pnpm dev:env`) y `packages/worker/.env`
 * si existen, sin pisar variables ya exportadas. Requiere `REDIS_URL`.
 */
function loadLocalEnv(): void {
  for (const file of ["../shared/.env", ".env"]) {
    const path = `${process.cwd()}/${file}`;
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  if (!process.env.REDIS_URL) {
    // Sin Redis no hay cola que consumir. En vez de tumbar el proceso (rompería
    // `pnpm dev`, que arranca todos los `dev`), se queda inactivo avisando.
    logger.warn(
      "analytics worker: REDIS_URL no configurado; worker inactivo (expórtalo o escríbelo en packages/worker/.env)",
    );
    await new Promise<never>(() => {});
    return;
  }

  const connection = createQueueRedis();
  const worker = createAnalyticsWorker({
    store: prisma.analyticsEvent as unknown as AnalyticsEventStore,
    connection,
  });

  worker.on("ready", () => {
    logger.info("analytics worker: consumiendo la cola de analítica");
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "analytics worker: cerrando");
    await worker.close();
    await connection.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
