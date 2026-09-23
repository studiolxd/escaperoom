import { describe, expect, it } from "vitest";
import {
  CURRENT_TERMS_VERSION,
  createInMemoryTermsAcceptanceStore,
  createTermsAcceptanceService,
} from "../src/services/legal-acceptance";

describe("createTermsAcceptanceService", () => {
  it("exige reaceptación si el usuario nunca aceptó ninguna versión", async () => {
    const store = createInMemoryTermsAcceptanceStore();
    const service = createTermsAcceptanceService({ store });

    const status = await service.getStatus("user-1");

    expect(status).toEqual({ needsAcceptance: true, version: CURRENT_TERMS_VERSION });
  });

  it("exige reaceptación si la versión aceptada quedó desactualizada", async () => {
    const store = createInMemoryTermsAcceptanceStore({
      acceptedVersions: { "user-1": "2025-01-01" },
    });
    const service = createTermsAcceptanceService({ store });

    const status = await service.getStatus("user-1");

    expect(status.needsAcceptance).toBe(true);
  });

  it("no exige reaceptación si el usuario ya aceptó la versión vigente", async () => {
    const store = createInMemoryTermsAcceptanceStore({
      acceptedVersions: { "user-1": CURRENT_TERMS_VERSION },
    });
    const service = createTermsAcceptanceService({ store });

    const status = await service.getStatus("user-1");

    expect(status.needsAcceptance).toBe(false);
  });

  it("registrar la aceptación crea el histórico y desbloquea al usuario", async () => {
    const store = createInMemoryTermsAcceptanceStore();
    const service = createTermsAcceptanceService({ store });

    const row = await service.accept("user-1", { ipAddress: "1.2.3.4", userAgent: "vitest" });

    expect(row).toMatchObject({
      userId: "user-1",
      version: CURRENT_TERMS_VERSION,
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
    });
    expect(store.rows).toHaveLength(1);
    await expect(service.getStatus("user-1")).resolves.toEqual({
      needsAcceptance: false,
      version: CURRENT_TERMS_VERSION,
    });
  });

  it("cada aceptación queda registrada en el histórico, incluso repetidas", async () => {
    const store = createInMemoryTermsAcceptanceStore();
    const service = createTermsAcceptanceService({ store });

    await service.accept("user-1", { ipAddress: null, userAgent: null });
    await service.accept("user-1", { ipAddress: null, userAgent: null });

    expect(store.rows).toHaveLength(2);
  });
});
