import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EventDashboardView } from "@/components/event-panel/event-dashboard";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "EventPanel" });
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * Panel del organizador (ticket 5.9, specs/19 §2). La página es un cascarón:
 * los datos (y la autorización, solo el organizador) vienen de
 * `GET /api/events/:id/dashboard`, que el panel sondea para ir en vivo.
 */
export default async function EventDashboardPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <main className="relative min-h-dvh bg-slate-950 p-4 text-white md:p-8">
      <div className="mx-auto max-w-6xl">
        <EventDashboardView eventId={id} />
      </div>
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
