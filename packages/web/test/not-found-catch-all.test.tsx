import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * DEUDA "404 de URLs que no existen" (auditoría 2026-09-24, PR #153): una URL
 * sin ninguna página que la capture debe usar el 404 con la shell pública, no
 * el genérico de Next (en inglés y sin estilos). Dos piezas:
 *
 * - `[locale]/(public)/[...rest]/page.tsx`: comodín para cualquier URL con
 *   locale válido que ninguna otra ruta capturó — llama a `notFound()` para
 *   que renderice `(public)/not-found.tsx` (cabecera/pie públicos).
 * - `app/global-not-found.tsx`: red de seguridad para URLs sin locale que
 *   `proxy.ts` no redirige (su matcher trata un segmento con punto como
 *   asset estático). Bypassa TODO layout, así que se comprueba por separado
 *   (mismo motivo que `public-error-pages.test.tsx`).
 */

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "--font-sans" }) }));

describe("[locale]/(public)/[...rest]/page.tsx — comodín del 404", () => {
  it("llama a notFound() tras fijar el locale de la petición", async () => {
    const { default: CatchAllNotFound } = await import(
      "../src/app/[locale]/(public)/[...rest]/page"
    );
    const { setRequestLocale } = await import("next-intl/server");

    await expect(
      CatchAllNotFound({ params: Promise.resolve({ locale: "es", rest: ["una", "ruta"] }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(setRequestLocale).toHaveBeenCalledWith("es");
    expect(notFound).toHaveBeenCalledOnce();
  });
});

describe("app/global-not-found.tsx — red de seguridad sin locale", () => {
  it("<html>/<body> propios, copia fija en español y enlaces al inicio/catálogo", async () => {
    const { default: GlobalNotFound } = await import("../src/app/global-not-found");
    const html = renderToStaticMarkup(createElement(GlobalNotFound));

    expect(html).toContain("<html");
    expect(html).toContain('lang="es"');
    expect(html).toContain("No hemos encontrado esta página");
    expect(html).toContain("El enlace puede estar roto o la página ya no existe.");
    expect(html).toContain('href="/es"');
    expect(html).toContain('href="/es/rooms"');
  });
});
