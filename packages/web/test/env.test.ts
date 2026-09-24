import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * E-4: el esquema de entorno (`src/env.ts`) no se importaba desde ningún
 * runtime real. Aquí se comprueba lo que `instrumentation.ts` dispara al
 * arrancar: en producción, sin las variables listadas, `validateEnvOnBoot`
 * lanza en vez de dejar que la app arranque con secretos ausentes.
 */
describe("validateEnvOnBoot (E-4)", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("en development, sin ninguna variable de producción configurada, no lanza", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "development",
      APP_SECRET: undefined,
      BETTER_AUTH_SECRET: undefined,
      REDIS_URL: undefined,
      EMAIL_FROM: undefined,
    };
    vi.resetModules();
    const { validateEnvOnBoot } = await import("../src/env");
    expect(() => validateEnvOnBoot()).not.toThrow();
  });

  it("en producción, sin REDIS_URL (entre otras) lanza", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      APP_NAME: "EscapeRoom",
      APP_URL: "https://app.example.com",
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      DATABASE_URL: "postgresql://u:p@host:5432/db",
      APP_SECRET: "s".repeat(32),
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com",
      JOIN_TOKEN_SECRET: "join-secret",
      PLAYTEST_SECRET: "playtest-secret",
      PUBLISH_CONFIRM_SECRET: "publish-secret",
      EMAIL_FROM: "no-reply@example.com",
      EMAIL_FROM_NAME: "EscapeRoom",
      STORAGE_BUCKET: "bucket",
      REDIS_URL: undefined,
    };
    vi.resetModules();
    const { validateEnvOnBoot } = await import("../src/env");
    expect(() => validateEnvOnBoot()).toThrow(/REDIS_URL/);
  });

  it("en producción, con todas las variables requeridas presentes, no lanza", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      APP_NAME: "EscapeRoom",
      APP_URL: "https://app.example.com",
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      DATABASE_URL: "postgresql://u:p@host:5432/db",
      APP_SECRET: "s".repeat(32),
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "https://app.example.com",
      REDIS_URL: "redis://localhost:6379",
      JOIN_TOKEN_SECRET: "join-secret",
      PLAYTEST_SECRET: "playtest-secret",
      PUBLISH_CONFIRM_SECRET: "publish-secret",
      EMAIL_FROM: "no-reply@example.com",
      EMAIL_FROM_NAME: "EscapeRoom",
      STORAGE_BUCKET: "bucket",
    };
    vi.resetModules();
    const { validateEnvOnBoot } = await import("../src/env");
    expect(() => validateEnvOnBoot()).not.toThrow();
  });
});
