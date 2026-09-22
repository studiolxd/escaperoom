import { getTranslations, setRequestLocale } from "next-intl/server";
import { GameShell } from "@/components/game/game-shell";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { Link } from "@/i18n/navigation";

type Props = { params: Promise<{ locale: string }> };

/**
 * Página de prueba de i18n (ticket 0.9): el copy sale del catálogo y el
 * selector cambia de locale conservando la ruta.
 */
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Home" });

  return (
    <main className="relative min-h-dvh bg-background p-4">
      <GameShell />

      <div className="pointer-events-auto absolute left-1/2 top-6 w-[min(90vw,30rem)] -translate-x-1/2 rounded-xl border border-white/10 bg-black/60 px-5 py-4 text-center text-white backdrop-blur">
        <p className="text-[0.7rem] uppercase tracking-[0.2em] text-white/50">{t("showcase")}</p>
        <h1 className="mt-1 text-lg font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-white/70">{t("subtitle")}</p>
        <div className="mt-3 flex justify-center">
          <LocaleSwitcher />
        </div>
        <p className="mt-3 text-[0.7rem] text-amber-200/80">{t("fallbackDemo")}</p>
      </div>

      <Link
        href="/lobby"
        className="absolute bottom-6 right-6 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-sm text-white backdrop-blur transition-colors hover:bg-black/80"
      >
        {t("lobbyCta")} →
      </Link>
    </main>
  );
}
