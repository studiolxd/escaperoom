import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `ACTIVE_OPTIONAL_CATEGORIES` decide si el banner/panel de preferencias le
 * aparece a alguien (docs/DEUDA.md «Claves reales de analítica antes de
 * desplegar en producción»): solo debe incluir "analytics" cuando Google
 * Analytics está configurado (Plausible no usa cookies y no entra en el
 * consentimiento).
 */
describe("ACTIVE_OPTIONAL_CATEGORIES / hasConsentUI", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("sin NEXT_PUBLIC_GA_MEASUREMENT_ID: lista vacía, sin UI de consentimiento", async () => {
    process.env = { ...process.env, NEXT_PUBLIC_GA_MEASUREMENT_ID: undefined };
    vi.resetModules();
    const { ACTIVE_OPTIONAL_CATEGORIES, hasConsentUI } =
      await import("../src/lib/cookie-consent-config");
    expect(ACTIVE_OPTIONAL_CATEGORIES).toEqual([]);
    expect(hasConsentUI()).toBe(false);
  });

  it("con NEXT_PUBLIC_GA_MEASUREMENT_ID configurado: incluye analytics y activa la UI", async () => {
    process.env = { ...process.env, NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-DEV0000000" };
    vi.resetModules();
    const { ACTIVE_OPTIONAL_CATEGORIES, hasConsentUI } =
      await import("../src/lib/cookie-consent-config");
    expect(ACTIVE_OPTIONAL_CATEGORIES).toEqual(["analytics"]);
    expect(hasConsentUI()).toBe(true);
  });
});
