// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleAnalyticsScript } from "../src/components/analytics/google-analytics-script";

// Requiere el arreglo de esta sección: `ready` empieza en `false`, así que el
// primer render (antes de leer la cookie de consentimiento) deja
// `ga-disable-<id>` en `true`; si luego el consentimiento resulta aceptado,
// ese flag debe revertirse a `false` explícitamente o `gtag` quedaría
// permanentemente desactivado pese a estar "cargado" (verificado a mano en
// `pnpm dev`: sin este arreglo, aceptar la categoría nunca medía nada).

/**
 * GA solo se carga tras aceptar la categoría "analytics" (docs/DEUDA.md
 * «Claves reales de analítica antes de desplegar en producción»). Al
 * rechazar o retirar el consentimiento, además de no cargar el script, hay
 * que apagar `gtag` ya cargado (`window['ga-disable-<id>']`) y borrar las
 * cookies `_ga`/`_ga_*` que hubiera dejado.
 */

const useConsentMock = vi.fn();
vi.mock("@/components/consent/consent-provider", () => ({
  useConsent: () => useConsentMock(),
}));

const MEASUREMENT_ID = "G-TEST1234";

afterEach(() => {
  cleanup();
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  });
  delete (window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`];
  vi.clearAllMocks();
});

describe("GoogleAnalyticsScript", () => {
  it("sin consentimiento (o antes de leer la cookie): no renderiza nada y no toca cookies", () => {
    useConsentMock.mockReturnValue({ ready: false, categories: { analytics: false } });
    const { container } = render(
      <GoogleAnalyticsScript measurementId={MEASUREMENT_ID} nonce="n" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("con la categoría analytics rechazada: apaga gtag y borra las cookies _ga/_ga_*", () => {
    document.cookie = "_ga=GA1.1.123; path=/";
    document.cookie = `_ga_${MEASUREMENT_ID.replace(/^G-/, "")}=GS1.1.456; path=/`;
    useConsentMock.mockReturnValue({ ready: true, categories: { analytics: false } });

    render(<GoogleAnalyticsScript measurementId={MEASUREMENT_ID} nonce="n" />);

    expect((window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`]).toBe(
      true,
    );
    expect(document.cookie).not.toContain("_ga=");
    expect(document.cookie).not.toContain(`_ga_${MEASUREMENT_ID.replace(/^G-/, "")}=`);
  });

  it("con la categoría analytics aceptada: no apaga gtag", () => {
    useConsentMock.mockReturnValue({ ready: true, categories: { analytics: true } });
    render(<GoogleAnalyticsScript measurementId={MEASUREMENT_ID} nonce="n" />);
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`]).toBe(
      false,
    );
  });

  it("al pasar de sin-decidir/rechazado a aceptado (mismo montaje): revierte el apagado de gtag", () => {
    useConsentMock.mockReturnValue({ ready: false, categories: { analytics: false } });
    const { rerender } = render(<GoogleAnalyticsScript measurementId={MEASUREMENT_ID} nonce="n" />);
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`]).toBe(
      true,
    );

    useConsentMock.mockReturnValue({ ready: true, categories: { analytics: true } });
    rerender(<GoogleAnalyticsScript measurementId={MEASUREMENT_ID} nonce="n" />);

    expect((window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`]).toBe(
      false,
    );
  });
});
