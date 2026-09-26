// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readWorkerConfig } from "../src/config";

describe("readWorkerConfig", () => {
  it("usa los valores por defecto de cada factoría sin variables de entorno", () => {
    const config = readWorkerConfig({});

    expect(config).toEqual({
      analytics: { concurrency: 20 },
      accessKeyCards: { concurrency: 2 },
      accessKeyExpiry: { everyMs: 60_000 },
      accessKeyEmailPurge: { everyMs: 3_600_000 },
      ipUaPurge: { everyMs: 3_600_000 },
      invitationEmail: { concurrency: 5 },
      purchaseConfirmationEmail: { concurrency: 5 },
      purchaseConfirmationOutbox: { everyMs: 300_000 },
      creatorPayouts: { everyMs: 300_000 },
      analyticsPartitions: { cron: "0 3 1 * *" },
      moderationSampling: { cron: "0 6 * * *" },
      stripeWebhookPurge: { everyMs: 24 * 60 * 60 * 1000 },
      mcpOAuthPurge: { everyMs: 3_600_000 },
    });
  });

  it("aplica overrides por variable de entorno", () => {
    const config = readWorkerConfig({
      WORKER_ANALYTICS_CONCURRENCY: "40",
      WORKER_ACCESS_KEY_EXPIRY_EVERY_MS: "30000",
      WORKER_ANALYTICS_PARTITIONS_CRON: "0 4 1 * *",
    });

    expect(config.analytics.concurrency).toBe(40);
    expect(config.accessKeyExpiry.everyMs).toBe(30_000);
    expect(config.analyticsPartitions.cron).toBe("0 4 1 * *");
    // El resto sigue en su valor por defecto.
    expect(config.accessKeyCards.concurrency).toBe(2);
  });

  it.each([
    ["WORKER_ANALYTICS_CONCURRENCY", "abc"],
    ["WORKER_ANALYTICS_CONCURRENCY", "0"],
    ["WORKER_ANALYTICS_CONCURRENCY", "-5"],
    ["WORKER_ANALYTICS_CONCURRENCY", "3.5"],
    ["WORKER_ACCESS_KEY_EXPIRY_EVERY_MS", "0"],
  ])("falla con un mensaje claro si %s=%s no es un entero positivo", (key, value) => {
    expect(() => readWorkerConfig({ [key]: value })).toThrow(/Configuración del worker inválida/);
  });

  it.each([
    ["WORKER_ANALYTICS_PARTITIONS_CRON", "no es un cron"],
    ["WORKER_MODERATION_SAMPLING_CRON", "61 * * * *"],
  ])("falla con un mensaje claro si %s=%s no es un cron válido", (key, value) => {
    expect(() => readWorkerConfig({ [key]: value })).toThrow(/Configuración del worker inválida/);
  });

  it("el mensaje de error incluye la variable y el valor recibido", () => {
    expect(() => readWorkerConfig({ WORKER_ANALYTICS_CONCURRENCY: "abc" })).toThrow(
      /WORKER_ANALYTICS_CONCURRENCY/,
    );
  });
});
