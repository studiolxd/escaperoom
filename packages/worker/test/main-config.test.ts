// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `main.ts` construye `workerConfig` una vez (E-23) y lo pasa a cada
 * factoría. Aquí se comprueba el cableado en sí (que cada `create*Worker`
 * recibe la `concurrency`/`everyMs`/`pattern` de `workerConfig`), no la
 * lógica de cada factoría (ya cubierta en su propio test).
 *
 * Se mockean todas las dependencias externas (Prisma, Redis, Stripe, email,
 * logger…) para que `main()` arranque solo las factorías incondicionales
 * (analítica, caducidad de claves, tarjetas, particiones, muestreo de
 * moderación, purga de stripeWebhookEvent y de OAuth del MCP); las que
 * dependen de un secreto/transporte configurado (purga de email/IP-UA,
 * invitaciones, confirmación de compra, reparto a creadores) quedan
 * inactivas por diseño cuando ese secreto no está presente, así que no hace
 * falta mockear su camino completo para este test.
 */

vi.mock("node:fs", () => ({ existsSync: vi.fn(() => false) }));

vi.mock("@escaperoom/env", () => ({ requireInProduction: vi.fn() }));
vi.mock("@escaperoom/kit/redis", () => ({
  createQueueRedis: vi.fn(() => ({ quit: vi.fn(async () => undefined) })),
}));
vi.mock("@escaperoom/kit/queue", () => ({ closeSharedQueueConnection: vi.fn(async () => undefined) }));
vi.mock("@escaperoom/kit/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@escaperoom/kit/observability/sentry-node", () => ({ initNodeSentry: vi.fn() }));
vi.mock("@escaperoom/kit/storage", () => ({ storage: { putObject: vi.fn() } }));
vi.mock("@escaperoom/shared/analytics", () => ({
  createPrismaPartitionMaintenanceDb: vi.fn(() => ({})),
}));
vi.mock("@escaperoom/shared/db", () => ({ prisma: { analyticsEvent: {}, $disconnect: vi.fn() } }));
vi.mock("@escaperoom/shared/mail", () => ({
  createMailTransportFromEnv: vi.fn(() => null),
  readConfirmationTokenConfig: vi.fn(() => ({})),
}));
vi.mock("@escaperoom/shared/services", () => ({
  createAccessKeyCardsService: vi.fn(() => ({})),
  createModerationService: vi.fn(() => ({})),
  createPrismaAccessKeyCardStore: vi.fn(() => ({})),
  createPrismaModerationStore: vi.fn(() => ({})),
  createPrismaAccessKeyStore: vi.fn(() => ({})),
  createPrismaAccessKeyEmailPurgeStore: vi.fn(() => ({})),
  createPrismaCreatorPayoutStore: vi.fn(() => ({})),
  createPrismaInvitationStore: vi.fn(() => ({})),
  createPrismaMcpOAuthPurgeStore: vi.fn(() => ({})),
  createPrismaPurchaseConfirmationStore: vi.fn(() => ({})),
  createPrismaSessionIpUaPurgeStore: vi.fn(() => ({})),
  createPrismaStripeWebhookEventPurgeStore: vi.fn(() => ({})),
  createPrismaTermsAcceptanceIpUaPurgeStore: vi.fn(() => ({})),
  createStripeClient: vi.fn(() => ({})),
  createStripeConnectGateway: vi.fn(() => ({})),
  createStripePaymentGateway: vi.fn(() => ({})),
  readEmailPurgeSecret: vi.fn(() => null),
  readIpUaPurgeSecret: vi.fn(() => null),
  readStripeConfig: vi.fn(() => ({ configured: false })),
}));
vi.mock("../src/health-server", () => ({ startWorkerHealthServer: vi.fn(() => null) }));

const createAnalyticsWorker = vi.fn(() => ({ on: vi.fn() }));
vi.mock("../src/worker", () => ({ createAnalyticsWorker }));

const createAccessKeyExpiryWorker = vi.fn(async () => ({ worker: {}, queue: {} }));
vi.mock("../src/access-key-expiry", () => ({ createAccessKeyExpiryWorker }));

const createAccessKeyEmailPurgeWorker = vi.fn(async () => ({ worker: {}, queue: {} }));
vi.mock("../src/access-key-email-purge", () => ({ createAccessKeyEmailPurgeWorker }));

const createIpUaPurgeWorker = vi.fn(async () => ({ worker: {}, queue: {} }));
vi.mock("../src/ip-ua-purge", () => ({ createIpUaPurgeWorker }));

const createInvitationEmailWorker = vi.fn(() => ({ close: vi.fn() }));
vi.mock("../src/invitation-email", () => ({ createInvitationEmailWorker }));

const createPurchaseConfirmationEmailWorker = vi.fn(() => ({ close: vi.fn() }));
vi.mock("../src/purchase-confirmation-email", () => ({ createPurchaseConfirmationEmailWorker }));

const createPurchaseConfirmationOutboxWorker = vi.fn(async () => ({ worker: {}, queue: {} }));
vi.mock("../src/purchase-confirmation-outbox", () => ({ createPurchaseConfirmationOutboxWorker }));

const createCreatorPayoutsWorker = vi.fn(async () => ({ worker: {}, queue: {} }));
vi.mock("../src/creator-payouts", () => ({ createCreatorPayoutsWorker }));

const createAccessKeyCardsWorker = vi.fn(() => ({ close: vi.fn() }));
vi.mock("../src/access-key-cards", () => ({ createAccessKeyCardsWorker }));

const createAnalyticsPartitionsWorker = vi.fn(async () => ({ worker: {}, queue: {} }));
vi.mock("../src/analytics-partitions", () => ({ createAnalyticsPartitionsWorker }));

const createModerationSamplingWorker = vi.fn(async () => ({ worker: {}, queue: {} }));
vi.mock("../src/moderation-sampling", () => ({ createModerationSamplingWorker }));

const createStripeWebhookPurgeWorker = vi.fn(async () => ({ worker: {}, queue: {} }));
vi.mock("../src/stripe-webhook-purge", () => ({ createStripeWebhookPurgeWorker }));

const createMcpOAuthPurgeWorker = vi.fn(async () => ({ worker: {}, queue: {} }));
vi.mock("../src/mcp-oauth-purge", () => ({ createMcpOAuthPurgeWorker }));

const ENV_KEYS = [
  "REDIS_URL",
  "NODE_ENV",
  "WORKER_ANALYTICS_CONCURRENCY",
  "WORKER_ACCESS_KEY_EXPIRY_EVERY_MS",
  "WORKER_ACCESS_KEY_CARDS_CONCURRENCY",
  "WORKER_ANALYTICS_PARTITIONS_CRON",
  "WORKER_MODERATION_SAMPLING_CRON",
  "WORKER_STRIPE_WEBHOOK_PURGE_EVERY_MS",
  "WORKER_MCP_OAUTH_PURGE_EVERY_MS",
] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.resetModules();
  vi.clearAllMocks();
});

describe("main.ts aplica workerConfig a cada factoría", () => {
  it("con overrides por entorno, cada factoría recibe el valor configurado", async () => {
    process.env.WORKER_ANALYTICS_CONCURRENCY = "7";
    process.env.WORKER_ACCESS_KEY_EXPIRY_EVERY_MS = "12345";
    process.env.WORKER_ACCESS_KEY_CARDS_CONCURRENCY = "9";
    process.env.WORKER_ANALYTICS_PARTITIONS_CRON = "0 5 1 * *";
    process.env.WORKER_MODERATION_SAMPLING_CRON = "30 7 * * *";
    process.env.WORKER_STRIPE_WEBHOOK_PURGE_EVERY_MS = "999000";
    process.env.WORKER_MCP_OAUTH_PURGE_EVERY_MS = "888000";

    await import("../src/main");

    expect(createAnalyticsWorker).toHaveBeenCalledWith(
      expect.objectContaining({ concurrency: 7 }),
    );
    expect(createAccessKeyExpiryWorker).toHaveBeenCalledWith(
      expect.objectContaining({ everyMs: 12345 }),
    );
    expect(createAccessKeyCardsWorker).toHaveBeenCalledWith(
      expect.objectContaining({ concurrency: 9 }),
    );
    expect(createAnalyticsPartitionsWorker).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: "0 5 1 * *" }),
    );
    expect(createModerationSamplingWorker).toHaveBeenCalledWith(
      expect.objectContaining({ cron: "30 7 * * *" }),
    );
    expect(createStripeWebhookPurgeWorker).toHaveBeenCalledWith(
      expect.objectContaining({ everyMs: 999000 }),
    );
    expect(createMcpOAuthPurgeWorker).toHaveBeenCalledWith(
      expect.objectContaining({ everyMs: 888000 }),
    );
  });

  it("sin overrides, cada factoría recibe los valores por defecto de siempre", async () => {
    await import("../src/main");

    expect(createAnalyticsWorker).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 20 }));
    expect(createAccessKeyExpiryWorker).toHaveBeenCalledWith(
      expect.objectContaining({ everyMs: 60_000 }),
    );
    expect(createAccessKeyCardsWorker).toHaveBeenCalledWith(
      expect.objectContaining({ concurrency: 2 }),
    );
    expect(createAnalyticsPartitionsWorker).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: "0 3 1 * *" }),
    );
    expect(createModerationSamplingWorker).toHaveBeenCalledWith(
      expect.objectContaining({ cron: "0 6 * * *" }),
    );
    expect(createStripeWebhookPurgeWorker).toHaveBeenCalledWith(
      expect.objectContaining({ everyMs: 24 * 60 * 60 * 1000 }),
    );
    expect(createMcpOAuthPurgeWorker).toHaveBeenCalledWith(
      expect.objectContaining({ everyMs: 3_600_000 }),
    );
  });
});
