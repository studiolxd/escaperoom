import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Better Auth activa su rate limit por defecto solo con `NODE_ENV=production`.
 * El E2E nocturno arranca así a propósito (paridad de arranque real) pero con
 * `ALLOW_DEV_SECRETS=1` (mismo criterio que el resto de atajos de desarrollo,
 * `isDevFallbackAllowed`): sin desactivarlo explícitamente, la suite completa
 * agotaba la cuota del enlace mágico (5/60s) entre varios specs y caía en 429
 * (issue #115, `docs/DEUDA.md`).
 */
describe("auth: rateLimit.enabled", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.resetModules();
  });

  it("producción real (sin ALLOW_DEV_SECRETS): activado", async () => {
    vi.resetModules();
    // @ts-expect-error -- NODE_ENV es de solo lectura en el tipo, no en runtime
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_DEV_SECRETS;
    const { auth } = await import("../src/lib/auth");
    expect(auth.options.rateLimit?.enabled).toBe(true);
  });

  it("E2E (NODE_ENV=production + ALLOW_DEV_SECRETS=1): desactivado", async () => {
    vi.resetModules();
    // @ts-expect-error -- idem
    process.env.NODE_ENV = "production";
    process.env.ALLOW_DEV_SECRETS = "1";
    const { auth } = await import("../src/lib/auth");
    expect(auth.options.rateLimit?.enabled).toBe(false);
  });

  it("desarrollo/test: desactivado (ya era el default de Better Auth)", async () => {
    vi.resetModules();
    // @ts-expect-error -- idem
    process.env.NODE_ENV = "test";
    delete process.env.ALLOW_DEV_SECRETS;
    const { auth } = await import("../src/lib/auth");
    expect(auth.options.rateLimit?.enabled).toBe(false);
  });
});
