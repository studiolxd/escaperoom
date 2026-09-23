import { existsSync } from "node:fs";
import { createQueueRedis } from "@escaperoom/kit/redis";
import { logger } from "@escaperoom/kit/logger";
import { storage } from "@escaperoom/kit/storage";
import { prisma } from "@escaperoom/shared/db";
import { createMailTransportFromEnv, readConfirmationTokenConfig } from "@escaperoom/shared/mail";
import {
  createAccessKeyCardsService,
  createPrismaAccessKeyCardStore,
  createPrismaAccessKeyStore,
  createPrismaInvitationStore,
} from "@escaperoom/shared/services";
import { createAccessKeyCardsWorker } from "./access-key-cards";
import { createAccessKeyExpiryWorker } from "./access-key-expiry";
import { createInvitationEmailWorker } from "./invitation-email";
import { createAnalyticsWorker, type AnalyticsEventStore } from "./worker";

/**
 * Arranque de los workers de cola: analítica (specs/16), caducidad de claves
 * (ticket 5.5, job repetitivo), envíos de invitación por email (ticket 5.6) y
 * PDF de tarjetas-clave (ticket 5.7).
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

  // Conexión propia: cada Worker de BullMQ bloquea la suya.
  const expiryConnection = createQueueRedis();
  const expiry = await createAccessKeyExpiryWorker({
    store: createPrismaAccessKeyStore(prisma),
    connection: expiryConnection,
  });

  // Envíos de invitación: sin transporte (config de email incompleta en
  // producción) no se consume la cola y los jobs esperan a que se configure.
  const transport = createMailTransportFromEnv();
  const mailConnection = transport ? createQueueRedis() : null;
  const invitations =
    transport && mailConnection
      ? createInvitationEmailWorker({
          deps: {
            store: createPrismaInvitationStore(prisma),
            transport,
            confirmation: readConfirmationTokenConfig(),
            appUrl: process.env.APP_URL?.trim() || "http://localhost:3000",
          },
          connection: mailConnection,
        })
      : null;
  if (!invitations) {
    logger.warn("invitation email: EMAIL_* incompleto; los envíos quedan en cola sin procesar");
  } else {
    logger.info({ provider: transport?.provider }, "invitation email: consumiendo la cola");
  }

  // PDF de tarjetas: el mismo servicio que web, sin cola ni firma (solo renderiza y sube).
  const cardsConnection = createQueueRedis();
  const cards = createAccessKeyCardsWorker({
    cards: createAccessKeyCardsService({
      store: createPrismaAccessKeyCardStore(prisma),
      queue: null,
      signingSecret: null,
    }),
    blobs: {
      put: (key, bytes, contentType) =>
        storage.putObject({ key, body: Buffer.from(bytes), contentType }),
    },
    connection: cardsConnection,
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "analytics worker: cerrando");
    await worker.close();
    await expiry.worker.close();
    await expiry.queue.close();
    await invitations?.close();
    await cards.close();
    await connection.quit().catch(() => undefined);
    await expiryConnection.quit().catch(() => undefined);
    await mailConnection?.quit().catch(() => undefined);
    await cardsConnection.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
