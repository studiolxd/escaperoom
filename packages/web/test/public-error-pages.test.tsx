import { createTranslator, NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";

/**
 * Deuda técnica (DEUDA.md, "páginas de error con la shell pública"): antes
 * `[locale]/error.tsx` y `[locale]/not-found.tsx` sustituían TODO el árbol
 * bajo `[locale]`, incluida la cabecera/pie de `(public)/layout.tsx`. Ahora
 * `(public)/error.tsx` y `(public)/not-found.tsx` viven en el mismo segmento
 * que ese layout, así que Next los envuelve con él en vez de sustituirlo
 * (docs de Next: "It does not wrap the layout.js ... above it in the same
 * segment"). Como el harness de tests no monta el App Router real, aquí se
 * comprueba por separado: (a) que `(public)/layout.tsx` sigue envolviendo a
 * su hijo con cabecera y pie (la garantía de la que depende la composición),
 * y (b) que el contenido propio de cada página de error es correcto.
 */

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    return createTranslator({ locale: "es", messages: es, namespace: namespace as never });
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href: `/es${href}`, ...rest }, children),
}));
vi.mock("@/components/layout/public-header", () => ({
  PublicHeader: () => createElement("header", { "data-testid": "public-header" }, "header"),
}));
vi.mock("@/components/layout/public-footer", () => ({
  PublicFooter: () => createElement("footer", { "data-testid": "public-footer" }, "footer"),
}));

const { default: PublicLayout } = await import("../src/app/[locale]/(public)/layout");
const { default: PublicNotFound } = await import("../src/app/[locale]/(public)/not-found");
const { default: PublicError } = await import("../src/app/[locale]/(public)/error");

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: "es",
      messages: es,
      timeZone: "UTC",
      children: element,
    }),
  );
}

describe("(public)/layout.tsx envuelve a su hijo con cabecera y pie públicos", () => {
  it("cabecera antes, pie después, hijo en medio", () => {
    const html = renderToStaticMarkup(
      createElement(PublicLayout, {
        children: createElement("div", { "data-testid": "child" }, "contenido"),
      }),
    );
    const headerIndex = html.indexOf('data-testid="public-header"');
    const childIndex = html.indexOf('data-testid="child"');
    const footerIndex = html.indexOf('data-testid="public-footer"');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(headerIndex).toBeLessThan(childIndex);
    expect(childIndex).toBeLessThan(footerIndex);
  });
});

describe("(public)/not-found.tsx — 404 con textos propios (namespace PublicNotFound)", () => {
  it("título, descripción y enlaces de inicio/catálogo", async () => {
    const html = render(await PublicNotFound());
    expect(html).toContain(es.PublicNotFound.title);
    expect(html).toContain(es.PublicNotFound.description);
    expect(html).toContain('href="/es/"');
    expect(html).toContain('href="/es/rooms"');
  });
});

describe("(public)/error.tsx — error genérico con textos propios (namespace PublicErrorPage)", () => {
  it("título, descripción y botón de reintentar", () => {
    const retry = vi.fn();
    const html = render(
      createElement(PublicError, { error: Object.assign(new Error("boom"), {}), retry }),
    );
    expect(html).toContain(es.PublicErrorPage.title);
    expect(html).toContain(es.PublicErrorPage.description);
    expect(html).toContain(es.PublicErrorPage.retry);
    expect(html).toContain('href="/es/"');
  });
});
