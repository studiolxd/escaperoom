import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

/**
 * Configuración centralizada del worker (E-23, resto): concurrencia, `everyMs`
 * y cron de cada factoría, hoy fijos en código sin forma de ajustarlos por
 * entorno. Los valores por defecto son los mismos que ya tenía cada factoría
 * (no se cambia ningún comportamiento); `readWorkerConfig` solo permite
 * sobrescribirlos por variable de entorno, validando con Zod y fallando al
 * arrancar con un mensaje claro si alguna es inválida.
 */

const positiveInt = (defaultValue: number) =>
  z.coerce
    .number({ error: "debe ser un número entero positivo" })
    .int({ error: "debe ser un número entero positivo" })
    .positive({ error: "debe ser un número entero positivo" })
    .default(defaultValue);

const cronPattern = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .refine(
      (pattern) => {
        try {
          CronExpressionParser.parse(pattern);
          return true;
        } catch {
          return false;
        }
      },
      { error: "debe ser un patrón cron válido" },
    );

const WorkerConfigSchema = z.object({
  WORKER_ANALYTICS_CONCURRENCY: positiveInt(20),
  WORKER_ACCESS_KEY_CARDS_CONCURRENCY: positiveInt(2),
  WORKER_ACCESS_KEY_EXPIRY_EVERY_MS: positiveInt(60_000),
  WORKER_ACCESS_KEY_EMAIL_PURGE_EVERY_MS: positiveInt(3_600_000),
  WORKER_IP_UA_PURGE_EVERY_MS: positiveInt(3_600_000),
  WORKER_INVITATION_EMAIL_CONCURRENCY: positiveInt(5),
  WORKER_PURCHASE_CONFIRMATION_EMAIL_CONCURRENCY: positiveInt(5),
  WORKER_PURCHASE_CONFIRMATION_OUTBOX_EVERY_MS: positiveInt(300_000),
  WORKER_CREATOR_PAYOUTS_EVERY_MS: positiveInt(300_000),
  WORKER_ANALYTICS_PARTITIONS_CRON: cronPattern("0 3 1 * *"),
  WORKER_MODERATION_SAMPLING_CRON: cronPattern("0 6 * * *"),
  WORKER_STRIPE_WEBHOOK_PURGE_EVERY_MS: positiveInt(24 * 60 * 60 * 1000),
  WORKER_MCP_OAUTH_PURGE_EVERY_MS: positiveInt(3_600_000),
});

export interface WorkerConfig {
  analytics: { concurrency: number };
  accessKeyCards: { concurrency: number };
  accessKeyExpiry: { everyMs: number };
  accessKeyEmailPurge: { everyMs: number };
  ipUaPurge: { everyMs: number };
  invitationEmail: { concurrency: number };
  purchaseConfirmationEmail: { concurrency: number };
  purchaseConfirmationOutbox: { everyMs: number };
  creatorPayouts: { everyMs: number };
  analyticsPartitions: { cron: string };
  moderationSampling: { cron: string };
  stripeWebhookPurge: { everyMs: number };
  mcpOAuthPurge: { everyMs: number };
}

/**
 * Lee y valida la configuración del worker desde el entorno. Falla con un
 * mensaje claro (variable por variable) si algo no es un entero positivo o un
 * cron válido, en vez de arrancar con un valor a medio parsear.
 */
export function readWorkerConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const result = WorkerConfigSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}=${JSON.stringify(env[String(issue.path[0])])} (${issue.message})`)
      .join("; ");
    throw new Error(`Configuración del worker inválida: ${details}`);
  }
  const raw = result.data;
  return {
    analytics: { concurrency: raw.WORKER_ANALYTICS_CONCURRENCY },
    accessKeyCards: { concurrency: raw.WORKER_ACCESS_KEY_CARDS_CONCURRENCY },
    accessKeyExpiry: { everyMs: raw.WORKER_ACCESS_KEY_EXPIRY_EVERY_MS },
    accessKeyEmailPurge: { everyMs: raw.WORKER_ACCESS_KEY_EMAIL_PURGE_EVERY_MS },
    ipUaPurge: { everyMs: raw.WORKER_IP_UA_PURGE_EVERY_MS },
    invitationEmail: { concurrency: raw.WORKER_INVITATION_EMAIL_CONCURRENCY },
    purchaseConfirmationEmail: { concurrency: raw.WORKER_PURCHASE_CONFIRMATION_EMAIL_CONCURRENCY },
    purchaseConfirmationOutbox: { everyMs: raw.WORKER_PURCHASE_CONFIRMATION_OUTBOX_EVERY_MS },
    creatorPayouts: { everyMs: raw.WORKER_CREATOR_PAYOUTS_EVERY_MS },
    analyticsPartitions: { cron: raw.WORKER_ANALYTICS_PARTITIONS_CRON },
    moderationSampling: { cron: raw.WORKER_MODERATION_SAMPLING_CRON },
    stripeWebhookPurge: { everyMs: raw.WORKER_STRIPE_WEBHOOK_PURGE_EVERY_MS },
    mcpOAuthPurge: { everyMs: raw.WORKER_MCP_OAUTH_PURGE_EVERY_MS },
  };
}
