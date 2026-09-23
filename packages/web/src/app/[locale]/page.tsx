import { getTranslations, setRequestLocale } from "next-intl/server";
import { GameShell } from "@/components/game/game-shell";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { Link } from "@/i18n/navigation";

type Props = { params: Promise<{ locale: string }> };

/**
 * Landing pública (ticket 6.7, specs/01 §2, specs/20, specs/25 §2.1): sin
 * autenticación, con la propuesta de valor y la waitlist. Debajo, en modo
 * "showcase" (ticket 0.9), sigue el fondo jugable de Phaser para dar contexto
 * visual inmediato del producto.
 */
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Home" });
  const l = await getTranslations({ locale, namespace: "Landing" });

  const audiences = ["creator", "player", "organizer"] as const;

  return (
    <main className="relative min-h-dvh bg-background">
      <section className="relative min-h-dvh p-4">
        <GameShell />

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/80" />

        <div className="pointer-events-auto absolute left-1/2 top-10 w-[min(94vw,42rem)] -translate-x-1/2 rounded-2xl border border-white/10 bg-black/70 px-6 py-6 text-center text-white backdrop-blur">
          <p className="text-[0.7rem] uppercase tracking-[0.2em] text-white/50">{l("kicker")}</p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{l("heroTitle")}</h1>
          <p className="mt-2 text-sm text-white/80 sm:text-base">{l("heroSubtitle")}</p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/creator/onboarding"
              className="rounded-full bg-amber-400 px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-300"
            >
              {l("ctaStartCreating")} →
            </Link>
            <Link
              href="/rooms"
              className="rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm text-white transition-colors hover:bg-white/20"
            >
              {l("ctaBrowseCatalog")}
            </Link>
          </div>

          <div className="mt-6 flex flex-col items-center gap-2 border-t border-white/10 pt-5">
            <p className="text-sm font-medium text-white/90">{l("waitlist.title")}</p>
            <p className="text-xs text-white/60">{l("waitlist.subtitle")}</p>
            <WaitlistForm />
          </div>

          <div className="mt-4">
            <LocaleSwitcher />
          </div>
        </div>

        <p className="pointer-events-auto absolute bottom-4 left-1/2 w-[min(90vw,30rem)] -translate-x-1/2 rounded-lg bg-black/60 px-3 py-2 text-center text-[0.65rem] text-amber-200/80 backdrop-blur">
          {t("showcase")} — {t("fallbackDemo")}
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center text-xl font-semibold">{l("valuePropsTitle")}</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {audiences.map((audience) => (
            <div
              key={audience}
              className="rounded-xl border border-border bg-card p-5 text-card-foreground"
            >
              <h3 className="font-semibold">{l(`valueProps.${audience}.title`)}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {l(`valueProps.${audience}.body`)}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">{t("subtitle")}</p>
        <div className="mt-4 flex justify-center gap-3">
          <Link
            href="/lobby"
            className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-muted"
          >
            {t("lobbyCta")} →
          </Link>
        </div>
      </section>
    </main>
  );
}
