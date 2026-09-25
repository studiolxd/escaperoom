import { existsSync } from "node:fs";
import type { Worker } from "bullmq";
import { requireInProduction } from "@escaperoom/env";
import { createQueueRedis } from "@escaperoom/kit/redis";
import { closeSharedQueueConnection } from "@escaperoom/kit/queue";
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
  createPrismaCreatorPayoutStore,
  createPrismaInvitationStore,
  createPrismaPurchaseConfirmationStore,
  createPrismaSessionIpUaPurgeStore,
  createPrismaTermsAcceptanceIpUaPurgeStore,
  createStripeClient,
  createStripeConnectGateway,
  createStripePaymentGateway,
  readEmailPurgeSecret,
  readIpUaPurgeSecret,
  readStripeConfig,
} from "@escaperoom/shared/services";
import { createAccessKeyCardsWorker } from "./access-key-cards";
import { createAnalyticsPartitionsWorker } from "./analytics-partitions";
import { createAccessKeyExpiryWorker } from "./access-key-expiry";
import { createAccessKeyEmailPurgeWorker } from "./access-key-email-purge";
import { createCreatorPayoutsWorker } from "./creator-payouts";
import { createIpUaPurgeWorker } from "./ip-ua-purge";
import { createInvitationEmailWorker } from "./invitation-email";
import { createPurchaseConfirmationEmailWorker } from "./purchase-confirmation-email";
import { createPurchaseConfirmationOutboxWorker } from "./purchase-confirmation-outbox";
import { createModerationSamplingWorker } from "./moderation-sampling";
import { createAnalyticsWorker, type AnalyticsEventStore } from "./worker";
import { startWorkerHealthServer } from "./health-server";

/** Tiempo máximo para cerrar limpio antes de forzar la salida (E-9). */
const SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Arranque de los workers de cola: analítica (specs/16), caducidad de claves
 * (ticket 5.5, job repetitivo), purga (hash) del email de claves tras el
 * plazo de retención (specs/18 §4.1), purga (hash + borrado) de IP/user-agent
 * en `session` y `termsAcceptance` (specs/18 §4.1), envíos de invitación por
 * email (ticket 5.6), confirmación de compra por email (specs/18 §3-4), PDF
 * de tarjetas-clave (ticket 5.7), particiones/purga de analítica (ticket
 * 6.11, job mensual) y muestreo aleatorio de moderación (ticket 6.1, diario).
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

  // E-4: en producción, sin estas variables el proceso no debe arrancar (y
  // menos quedarse "activo" degradando en silencio, como hacía antes el
  // aviso de más abajo si faltaba REDIS_URL).
  requireInProduction(process.env, [
    "DATABASE_URL",
    "APP_SECRET",
    "APP_URL",
    "EMAIL_FROM",
    "EMAIL_FROM_NAME",
    "STORAGE_BUCKET",
    "REDIS_URL",
  ]);
  logger.info(`[env] NODE_ENV=${process.env.NODE_ENV ?? "development"} validado`);

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

  // Confirmación de compra (specs/18 §3-4): mismo transporte y misma condición
  // de arranque que las invitaciones.
  const purchaseConfirmationConnection = transport ? createQueueRedis() : null;
  const purchaseConfirmations =
    transport && purchaseConfirmationConnection
      ? createPurchaseConfirmationEmailWorker({
          deps: {
            store: createPrismaPurchaseConfirmationStore(prisma),
            transport,
            appUrl: process.env.APP_URL?.trim() || "http://localhost:3000",
          },
          connection: purchaseConfirmationConnection,
        })
      : null;
  if (!purchaseConfirmations) {
    logger.warn("purchase confirmation email: EMAIL_* incompleto; los envíos quedan en cola sin procesar");
  } else {
    logger.info({ provider: transport?.provider }, "purchase confirmation email: consumiendo la cola");
  }

  // Outbox (E-11): reencola cualquier compra/evento pagado sin confirmar tras
  // el margen de gracia — la red si el enqueue del webhook se perdió (Redis
  // caído justo al liquidar el pago). Solo tiene sentido con transporte
  // configurado: sin él nadie consume lo que reencola.
  const purchaseConfirmationOutboxConnection = transport ? createQueueRedis() : null;
  const purchaseConfirmationOutbox =
    transport && purchaseConfirmationOutboxConnection
      ? await createPurchaseConfirmationOutboxWorker({
          store: createPrismaPurchaseConfirmationStore(prisma),
          connection: purchaseConfirmationOutboxConnection,
        })
      : null;

  // Reparto a creadores (B-9): reintenta la `Transfer` de cualquier compra
  // `room`/`room_license` `succeeded` sin `stripeTransferId`, fuera del
  // camino crítico del webhook de Stripe. Sin `STRIPE_SECRET_KEY` (dev/CI sin
  // clave configurada) no hay nada que transferir: inactivo.
  const stripeConfig = readStripeConfig();
  const stripeClient = stripeConfig.configured ? createStripeClient(stripeConfig.secretKey) : null;
  const payoutsConnection = stripeClient ? createQueueRedis() : null;
  const payouts =
    stripeClient && payoutsConnection
      ? await createCreatorPayoutsWorker({
          store: createPrismaCreatorPayoutStore(prisma),
          connect: createStripeConnectGateway(stripeClient),
          payments: createStripePaymentGateway(stripeClient),
          connection: payoutsConnection,
        })
      : null;
  if (!payouts) {
    logger.warn("creator payouts: STRIPE_SECRET_KEY no configurado; job inactivo");
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

  // Todos los Worker de BullMQ en marcha, para el readiness de /healthz: si
  // cualquiera deja de consumir (`isRunning() === false`) sin que el proceso
  // se haya caído, un orquestador debe poder verlo y reiniciar el pod.
  const allWorkers = (): Worker[] =>
    [
      worker,
      expiry.worker,
      emailPurge?.worker,
      ipUaPurge?.worker,
      invitations,
      purchaseConfirmations,
      cards,
      partitions.worker,
      sampling.worker,
      purchaseConfirmationOutbox?.worker,
      payouts?.worker,
    ].filter((w): w is Worker => Boolean(w));

  let closing = false;
  const healthServer = startWorkerHealthServer({
    shuttingDown: () => closing,
    workersRunning: () => allWorkers().every((w) => w.isRunning()),
    redis: () => connection,
  });

  const closeEverything = async (): Promise<void> => {
    await worker.close();
    await expiry.worker.close();
    await expiry.queue.close();
    await emailPurge?.worker.close();
    await emailPurge?.queue.close();
    await ipUaPurge?.worker.close();
    await ipUaPurge?.queue.close();
    await invitations?.close();
    await purchaseConfirmations?.close();
    await cards.close();
    await partitions.worker.close();
    await partitions.queue.close();
    await sampling.worker.close();
    await sampling.queue.close();
    await purchaseConfirmationOutbox?.worker.close();
    await purchaseConfirmationOutbox?.queue.close();
    await payouts?.worker.close();
    await payouts?.queue.close();
    await new Promise<void>((resolve, reject) =>
      healthServer ? healthServer.close((err) => (err ? reject(err) : resolve())) : resolve(),
    ).catch((err: unknown) => logger.warn({ err }, "analytics worker: fallo cerrando /healthz"));
    await connection.quit().catch(() => undefined);
    await expiryConnection.quit().catch(() => undefined);
    await emailPurgeConnection?.quit().catch(() => undefined);
    await ipUaPurgeConnection?.quit().catch(() => undefined);
    await mailConnection?.quit().catch(() => undefined);
    await purchaseConfirmationConnection?.quit().catch(() => undefined);
    await cardsConnection.quit().catch(() => undefined);
    await partitionsConnection.quit().catch(() => undefined);
    await samplingConnection.quit().catch(() => undefined);
    await purchaseConfirmationOutboxConnection?.quit().catch(() => undefined);
    await payoutsConnection?.quit().catch(() => undefined);
    // El propio barrido reencola con la conexión "productora" compartida de
    // kit (misma que usaría un `createPurchaseConfirmationEmailQueue()` en
    // web), no con `purchaseConfirmationOutboxConnection` (esa es solo del
    // Worker que consume el scheduler).
    if (purchaseConfirmationOutbox) await closeSharedQueueConnection().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  };

  // Apagado acotado (E-9): antes encadenaba 18 `await` sin límite — una
  // conexión de Redis colgada (p. ej. a mitad de un `BRPOPLPUSH`) dejaba el
  // proceso sin salir nunca, y sin `process.exit` un handle huérfano (timer,
  // socket) también lo habría hecho. `Promise.race` con un timeout de
  // `SHUTDOWN_TIMEOUT_MS` y `process.exit` al final garantizan que el proceso
  // siempre termina, limpio o no.
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "analytics worker: cerrando");
    const timedOut = Symbol("shutdown-timeout");
    const result = await Promise.race([
      closeEverything().then(() => "closed" as const),
      new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), SHUTDOWN_TIMEOUT_MS)),
    ]);
    if (result === timedOut) {
      logger.error({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, "analytics worker: apagado forzado por timeout");
      process.exit(1);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
