import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { ModerationQueueView } from "@/components/moderation/moderation-queue";
import { resolveActorFromHeaders } from "@/server/context";
import { getModerationService } from "@/server/services";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Moderation" });
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * Cola de moderación (ticket 6.1, specs/17 §4). Solo moderadores o
 * administradores (el mismo guard `isModerator | isAdmin` que la API): al
 * resto se le muestra un aviso sin cargar nada. Los datos vienen de
 * `/api/admin/reports` y `/api/admin/appeals`, que vuelven a comprobar el
 * permiso en cada llamada. El audio ya no pasa por cola de moderación previa
 * (ADR-039): no hay endpoint de admin para él.
 */
export default async function ModerationPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Moderation");
  const actor = await resolveActorFromHeaders(await headers());
  const allowed = await getModerationService().canModerate(actor);

  return (
    <main className="relative min-h-dvh bg-slate-950 p-4 text-white md:p-8">
      <div className="mx-auto max-w-4xl">
        {allowed ? (
          <ModerationQueueView />
        ) : (
          <p role="alert" className="text-sm text-red-300">
            {t("forbidden")}
          </p>
        )}
      </div>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
