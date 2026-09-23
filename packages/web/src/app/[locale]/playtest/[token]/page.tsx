import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { PlaytestClient } from "@/components/playtest/playtest-client";
import { isPlaytestExpired, readPlaytestToken } from "@/lib/playtest-link";

type Props = { params: Promise<{ locale: string; token: string }> };

/** Un borrador en pruebas no se indexa: el link es privado y no sale en el catálogo. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Página del link de prueba (ticket 3.8, specs/09 §3): juega un borrador sin
 * publicar en la room temporal de Colyseus. La abre el autor al pulsar
 * «Jugar» y cualquiera con el link (también invitados sin sesión) hasta que
 * caduca. El token solo se lee aquí; lo verifica el servidor de partidas.
 */
export default async function PlaytestPage({ params }: Props) {
  const { locale, token: rawToken } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("EditorPlaytest");
  const token = decodeURIComponent(rawToken);
  const payload = readPlaytestToken(token);
  const expired = payload ? isPlaytestExpired(payload) : false;

  return (
    <main className="relative min-h-dvh space-y-4 bg-slate-950 p-4 text-white">
      <header className="pr-40">
        <h1 className="text-lg font-semibold">{t("page.title")}</h1>
        <p className="text-sm text-white/60">{t("page.subtitle")}</p>
      </header>
      {!payload ? (
        <p role="alert" className="text-sm text-white/70">
          {t("page.invalidLink")}
        </p>
      ) : expired ? (
        <p role="alert" className="text-sm text-white/70">
          {t("page.expired")}
        </p>
      ) : (
        <PlaytestClient
          token={token}
          playtestId={payload.playtestId}
          expiresAt={payload.expiresAt}
        />
      )}
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
