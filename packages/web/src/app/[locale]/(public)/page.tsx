import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

type Props = { params: Promise<{ locale: string }> };

/**
 * Landing pública (ticket 6.7, specs/01 §2, specs/20, specs/25 §2.1): sin
 * autenticación, con la propuesta de valor. El hero es contenido estático
 * (sin el canvas de Phaser de fondo, ver `components/game/game-shell.tsx`
 * en el historial): header/footer ya los pone el layout de `(public)`.
 */
export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const l = await getTranslations({ locale, namespace: "Landing" });

  const audiences = ["player", "creator", "teacher", "company"] as const;

  return (
    <main className="bg-background">
      <section className="mx-auto flex min-h-[70dvh] w-full max-w-3xl flex-col items-center justify-center px-4 py-20 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{l("heroTitle")}</h1>
        <p className="mt-4 text-balance text-base text-muted-foreground sm:text-lg">
          {l("heroSubtitle")}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/creator/onboarding">{l("ctaStartCreating")}</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/rooms">{l("ctaBrowseCatalog")}</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </section>
    </main>
  );
}
