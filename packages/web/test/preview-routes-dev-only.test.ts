import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * Deuda técnica (DEUDA.md): `world-preview` y `room-preview` son
 * herramientas de QA interna (fixture fija, sin `roomId` real) — se
 * restringen con `isDevFallbackAllowed()` (mismo criterio que `/play` sin
 * `?session`) y devuelven 404 en producción en vez de retirarse.
 */

const state = vi.hoisted(() => ({ devFallbackAllowed: true }));

vi.mock("@escaperoom/env", () => ({
  isDevFallbackAllowed: () => state.devFallbackAllowed,
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
vi.mock("@escaperoom/game-runtime", () => ({
  loadRoomPackage: () => ({ map: { tileset: "stub" } }),
  toRuntimeModel: () => ({ meta: { id: "stub" } }),
}));
vi.mock("@/components/i18n/locale-switcher", () => ({
  LocaleSwitcher: () => createElement("div", { "data-testid": "locale-switcher" }),
}));
vi.mock("@/components/world-preview/world-preview-shell", () => ({
  WorldPreviewShell: () => createElement("div", { "data-testid": "world-preview-shell" }),
}));
vi.mock("@/lib/world-preview-fixture", () => ({
  worldPreviewPackage: () => ({}),
}));
vi.mock("@/components/room-preview/room-preview-shell", () => ({
  RoomPreviewShell: () => createElement("div", { "data-testid": "room-preview-shell" }),
}));
vi.mock("@/lib/room-preview-fixture", () => ({
  readReyAldricRoomPackageJson: () => "{}",
}));
vi.mock("@/lib/room-preview-pack", () => ({
  resolveRoomPreviewPack: () => ({ pack: undefined, issues: [] }),
}));

const { default: WorldPreviewPage } = await import("../src/app/[locale]/(creator)/world-preview/page");
const { default: RoomPreviewPage } = await import("../src/app/[locale]/(creator)/room-preview/page");

function pageParams() {
  return { params: Promise.resolve({ locale: "es" }) };
}

describe("world-preview y room-preview: solo con isDevFallbackAllowed()", () => {
  it("world-preview: 404 cuando isDevFallbackAllowed() es falso (producción sin bandera)", async () => {
    state.devFallbackAllowed = false;
    await expect(WorldPreviewPage(pageParams())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("world-preview: renderiza cuando isDevFallbackAllowed() es verdadero (desarrollo)", async () => {
    state.devFallbackAllowed = true;
    await expect(WorldPreviewPage(pageParams())).resolves.toBeTruthy();
  });

  it("room-preview: 404 cuando isDevFallbackAllowed() es falso (producción sin bandera)", async () => {
    state.devFallbackAllowed = false;
    await expect(RoomPreviewPage(pageParams())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("room-preview: renderiza cuando isDevFallbackAllowed() es verdadero (desarrollo)", async () => {
    state.devFallbackAllowed = true;
    await expect(RoomPreviewPage(pageParams())).resolves.toBeTruthy();
  });
});
