import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";

/**
 * F-14: páginas privadas/de desarrollo indexables por defecto (robots.txt
 * solo excluye `/*\/dev/`) y `(auth)/login`/`signup` sin `generateMetadata`.
 * Cubre que cada una declara ahora su `robots`/metadata explícita.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    createTranslator({ locale, messages: es, namespace: namespace as never }),
}));

describe("páginas de validación visual: robots noindex (F-14)", () => {
  it.each([
    ["room-preview", "../src/app/[locale]/(creator)/room-preview/page"],
    ["room-playtest", "../src/app/[locale]/(creator)/room-playtest/page"],
    ["world-preview", "../src/app/[locale]/(creator)/world-preview/page"],
    ["play-room", "../src/app/[locale]/(play)/play/room/[roomId]/page"],
    ["play-session", "../src/app/[locale]/(play)/play/session/[sessionId]/page"],
    ["dev-game-room", "../src/app/[locale]/(play)/dev/game-room/page"],
  ])("%s no se indexa", async (_name, path) => {
    const mod = (await import(path)) as { metadata?: { robots?: { index?: boolean } } };
    expect(mod.metadata?.robots).toMatchObject({ index: false, follow: false });
  });
});

describe("(auth)/login y /signup: metadata con canónica y hreflang (F-14)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://escape.example";
  });

  it("login", async () => {
    const { generateMetadata } = await import("../src/app/[locale]/(auth)/login/page");
    const meta = await generateMetadata({ params: Promise.resolve({ locale: "es" }) });
    expect(meta.alternates?.canonical).toBe("https://escape.example/es/login");
    expect(meta.title).toBeTruthy();
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("signup", async () => {
    const { generateMetadata } = await import("../src/app/[locale]/(auth)/signup/page");
    const meta = await generateMetadata({ params: Promise.resolve({ locale: "es" }) });
    expect(meta.alternates?.canonical).toBe("https://escape.example/es/signup");
    expect(meta.title).toBeTruthy();
    expect(meta.robots).toEqual({ index: true, follow: true });
  });
});
