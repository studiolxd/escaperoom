import { describe, expect, it } from "vitest";
import {
  bool,
  emptyStringAsUndefined,
  isDevFallbackAllowed,
  requireInProduction,
} from "../src/helpers";

describe("env helpers", () => {
  it("bool parses true/false strings", () => {
    expect(bool(false).parse("true")).toBe(true);
    expect(bool(true).parse("false")).toBe(false);
  });

  it("bool applies its default when unset", () => {
    expect(bool(true).parse(undefined)).toBe(true);
  });

  it("emptyStringAsUndefined turns empty strings into undefined", () => {
    expect(emptyStringAsUndefined({ A: "", B: "x" })).toEqual({ A: undefined, B: "x" });
  });
});

describe("isDevFallbackAllowed (E-4)", () => {
  it("solo development y test permiten el secreto/fixture de desarrollo", () => {
    expect(isDevFallbackAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(isDevFallbackAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("producción, un valor desconocido o ausente lo deniegan (lista blanca, no negra)", () => {
    expect(isDevFallbackAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(isDevFallbackAllowed({ NODE_ENV: "staging" })).toBe(false);
    expect(isDevFallbackAllowed({})).toBe(false);
  });

  it("ALLOW_DEV_SECRETS=1 lo permite incluso con NODE_ENV=production (entorno de prueba deliberado, p. ej. la suite E2E)", () => {
    expect(isDevFallbackAllowed({ NODE_ENV: "production", ALLOW_DEV_SECRETS: "1" })).toBe(true);
    expect(isDevFallbackAllowed({ NODE_ENV: "production", ALLOW_DEV_SECRETS: "true" })).toBe(
      true,
    );
    // Cualquier otro valor (incluida su ausencia) sigue denegando: no es una
    // lista negra.
    expect(isDevFallbackAllowed({ NODE_ENV: "production", ALLOW_DEV_SECRETS: "yes" })).toBe(
      false,
    );
    expect(isDevFallbackAllowed({ NODE_ENV: "production", ALLOW_DEV_SECRETS: "0" })).toBe(false);
  });
});

describe("requireInProduction (E-4)", () => {
  it("fuera de producción no exige nada", () => {
    expect(() => requireInProduction({}, ["APP_SECRET"])).not.toThrow();
    expect(() =>
      requireInProduction({ NODE_ENV: "development" }, ["APP_SECRET"]),
    ).not.toThrow();
  });

  it("en producción, falta una variable listada → lanza con su nombre", () => {
    expect(() =>
      requireInProduction({ NODE_ENV: "production", APP_SECRET: "x" }, [
        "APP_SECRET",
        "REDIS_URL",
      ]),
    ).toThrow(/REDIS_URL/);
  });

  it("en producción, con todas presentes no lanza", () => {
    expect(() =>
      requireInProduction({ NODE_ENV: "production", APP_SECRET: "x", REDIS_URL: "redis://x" }, [
        "APP_SECRET",
        "REDIS_URL",
      ]),
    ).not.toThrow();
  });
});
