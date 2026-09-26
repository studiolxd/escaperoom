// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { SimultaneousPlatesPublicView } from "@escaperoom/shared/templates";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { PlatesPanel } from "../../src/components/puzzles/plates-panel";

/**
 * F-43..47 punto 1 (auditoría 2026-09-24): la cuenta atrás usaba
 * `Date.now()` del navegador en vez del reloj del servidor — con el reloj
 * del jugador desfasado, el tiempo mostrado no coincidía con la ventana real
 * que resuelve el servidor. `getNow` deja que quien monta el panel decida el
 * reloj (por defecto `Date.now`, correcto en local/preview).
 */

afterEach(cleanup);

function makeView(overrides: Partial<SimultaneousPlatesPublicView> = {}): SimultaneousPlatesPublicView {
  return {
    id: "p-placas",
    type: "simultaneous_plates",
    state: "available",
    holdMode: "press",
    windowMs: 5_000,
    plates: [{ objectId: "placa-1", active: false, bridged: false, activatedAt: null }],
    activeCount: 0,
    totalCount: 1,
    windowEndsAt: 10_000,
    solvedAt: null,
    solvedBy: null,
    ...overrides,
  };
}

function renderPanel(props: Partial<ComponentProps<typeof PlatesPanel>> = {}) {
  render(
    createElement(NextIntlClientProvider, {
      locale: "es",
      messages: es,
      children: createElement(PlatesPanel, { view: makeView(), ...props }),
    }),
  );
  return document.querySelector('[data-slot="plates-countdown"]');
}

describe("PlatesPanel: reloj de la cuenta atrás", () => {
  it("por defecto usa `Date.now()` (local/preview, sin servidor)", () => {
    vi.spyOn(Date, "now").mockReturnValue(9_000);
    const countdown = renderPanel({ view: makeView({ windowEndsAt: 10_000 }) });

    // 10_000 - 9_000 = 1_000 ms → 1 s restante.
    expect(countdown).toHaveTextContent("Quedan 1 s");
    vi.restoreAllMocks();
  });

  it("con el reloj del jugador desfasado, `getNow` (reloj del servidor compensado) manda, no `Date.now()`", () => {
    // El reloj del ordenador va 20 s adelantado respecto al del servidor:
    // con `Date.now()` a secas, la ventana ya habría "cerrado".
    vi.spyOn(Date, "now").mockReturnValue(29_000);
    const serverNow = () => 9_000;

    const countdown = renderPanel({ view: makeView({ windowEndsAt: 10_000 }), getNow: serverNow });

    expect(countdown).toHaveTextContent("Quedan 1 s");
    vi.restoreAllMocks();
  });

  it("con `getNow`, la ventana se pinta cerrada cuando el reloj del servidor la supera, no cuando lo hace `Date.now()`", () => {
    // El reloj del jugador va 20 s por detrás: con `Date.now()` a secas, la
    // ventana seguiría "abierta" 20 s de más.
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const serverNow = () => 11_000;

    const countdown = renderPanel({ view: makeView({ windowEndsAt: 10_000 }), getNow: serverNow });

    expect(countdown).toHaveTextContent("La ventana se ha cerrado");
    vi.restoreAllMocks();
  });
});
