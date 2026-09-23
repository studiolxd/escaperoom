import { existsSync } from "node:fs";
import { createQueueRedis } from "@escaperoom/kit/redis";
import { logger } from "@escaperoom/kit/logger";
import { initNodeSentry } from "@escaperoom/kit/observability/sentry-node";
import { storage } from "@escaperoom/kit/storage";
import { createPrismaPartitionMaintenanceDb } from "@escaperoom/shared/analytics";
import { prisma } from "@escaperoom/shared/db";
import { createMailTransportFromEnv, readConfirmationTokenConfig } from "@escaperoom/shared/mail";
import {
  createAccessKeyCardsService,
  createModerationService,
  createPrismaAccessKeyCardStore,
  createPrismaModerationStore,
  createPrismaAccessKeyStore,
  createPrismaAccessKeyEmailPurgeStore,
  createPrismaInvitationStore,
  createPrismaSessionIpUaPurgeStore,
  createPrismaTermsAcceptanceIpUaPurgeStore,
  readEmailPurgeSecret,
  readIpUaPurgeSecret,
} from "@escaperoom/shared/services";
import { createAccessKeyCardsWorker } from "./access-key-cards";
import { createAnalyticsPartitionsWorker } from "./analytics-partitions";
import { createAccessKeyExpiryWorker } from "./access-key-expiry";
import { createAccessKeyEmailPurgeWorker } from "./access-key-email-purge";
import { createIpUaPurgeWorker } from "./ip-ua-purge";
import { createInvitationEmailWorker } from "./invitation-email";
import { createModerationSamplingWorker } from "./moderation-sampling";
import { createAnalyticsWorker, type AnalyticsEventStore } from "./worker";

/**
 * Arranque de los workers de cola: analítica (specs/16), caducidad de claves
 * (ticket 5.5, job repetitivo), purga (hash) del email de claves tras el
 * plazo de retención (specs/18 §4.1), purga (hash + borrado) de IP/user-agent
 * en `session` y `termsAcceptance` (specs/18 §4.1), envíos de invitación por
 * email (ticket 5.6), PDF de tarjetas-clave (ticket 5.7), particiones/purga
 * de analítica (ticket 6.11, job mensual) y muestreo aleatorio de moderación
 * (ticket 6.1, diario).
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

  // Sentry (ticket 6.4): sin SENTRY_DSN queda deshabilitado, sin romper nada.
  initNodeSentry({ dsn: process.env.SENTRY_DSN });

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

  // Purga (hash) del email de claves: sin APP_SECRET en producción, inactivo.
  const emailPurgeSecret = readEmailPurgeSecret();
  const emailPurgeConnection = emailPurgeSecret ? createQueueRedis() : null;
  const emailPurge =
    emailPurgeSecret && emailPurgeConnection
      ? await createAccessKeyEmailPurgeWorker({
          store: createPrismaAccessKeyEmailPurgeStore(prisma),
          secret: emailPurgeSecret,
          connection: emailPurgeConnection,
        })
      : null;
  if (!emailPurge) {
    logger.warn("access-key email purge: APP_SECRET no configurado; job inactivo");
  }

  // Purga de IP/user-agent de session y termsAcceptance: mismo APP_SECRET.
  const ipUaPurgeSecret = readIpUaPurgeSecret();
  const ipUaPurgeConnection = ipUaPurgeSecret ? createQueueRedis() : null;
  const ipUaPurge =
    ipUaPurgeSecret && ipUaPurgeConnection
      ? await createIpUaPurgeWorker({
          stores: {
            session: createPrismaSessionIpUaPurgeStore(prisma),
            termsAcceptance: createPrismaTermsAcceptanceIpUaPurgeStore(prisma),
          },
          secret: ipUaPurgeSecret,
          connection: ipUaPurgeConnection,
        })
      : null;
  if (!ipUaPurge) {
    logger.warn("ip/user-agent purge: APP_SECRET no configurado; job inactivo");
  }

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

  // Particiones de analyticsEvent: crea la del mes siguiente y purga > 24 meses.
  const partitionsConnection = createQueueRedis();
  const partitions = await createAnalyticsPartitionsWorker({
    db: createPrismaPartitionMaintenanceDb(prisma),
    connection: partitionsConnection,
  });

  // Muestreo de moderación: encola a revisión humana lo publicado recientemente.
  const samplingConnection = createQueueRedis();
  const sampling = await createModerationSamplingWorker({
    moderation: createModerationService({ store: createPrismaModerationStore(prisma) }),
    connection: samplingConnection,
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "analytics worker: cerrando");
    await worker.close();
    await expiry.worker.close();
    await expiry.queue.close();
    await emailPurge?.worker.close();
    await emailPurge?.queue.close();
    await ipUaPurge?.worker.close();
    await ipUaPurge?.queue.close();
    await invitations?.close();
    await cards.close();
    await partitions.worker.close();
    await partitions.queue.close();
    await sampling.worker.close();
    await sampling.queue.close();
    await connection.quit().catch(() => undefined);
    await expiryConnection.quit().catch(() => undefined);
    await emailPurgeConnection?.quit().catch(() => undefined);
    await ipUaPurgeConnection?.quit().catch(() => undefined);
    await mailConnection?.quit().catch(() => undefined);
    await cardsConnection.quit().catch(() => undefined);
    await partitionsConnection.quit().catch(() => undefined);
    await samplingConnection.quit().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
