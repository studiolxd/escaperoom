import { createTranslator, NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";

/**
 * F-28: `roomId`/`eventId` de la URL de confirmación (destino del redirect
 * de Stripe) se interpolaban en el `href` sin validar, y los enlaces
 * internos usaban `next/link` en vez del `Link` con locale de
 * `@/i18n/navigation`.
 */

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async (arg: string | { namespace: string }) => {
    const namespace = typeof arg === "string" ? arg : arg.namespace;
    return createTranslator({ locale: "es", messages: es, namespace: namespace as never });
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href: `/es${href}`, ...rest }, children),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/checkout/confirmation",
}));

const { default: CheckoutConfirmationPage } =
  await import("../src/app/[locale]/(play)/checkout/confirmation/page");

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

function pageParams(query: Record<string, string>) {
  return {
    params: Promise.resolve({ locale: "es" }),
    searchParams: Promise.resolve(query),
  };
}

describe("checkout/confirmation — validación de searchParams y Link i18n (F-28)", () => {
  it("roomId válido: enlaza a la ficha de la sala con locale", async () => {
    const html = render(
      await CheckoutConfirmationPage(
        pageParams({ type: "room", status: "success", roomId: "sala-1" }),
      ),
    );
    expect(html).toContain('href="/es/rooms/sala-1"');
  });

  it("roomId inválido (con `/`): cae al catálogo, no se interpola tal cual", async () => {
    const html = render(
      await CheckoutConfirmationPage(
        pageParams({ type: "room", status: "success", roomId: "../admin" }),
      ),
    );
    expect(html).not.toContain("../admin");
    expect(html).toContain('href="/es/rooms"');
  });

  it("type desconocido cae a la etiqueta genérica sin romper", async () => {
    const html = render(
      await CheckoutConfirmationPage(pageParams({ type: "nope", status: "success" })),
    );
    expect(html).toContain('href="/es/rooms"');
  });
});
