import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { dpaAnnex } from "@/content/legal/dpa";

type Props = { params: Promise<{ locale: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Anexo de encargo de tratamiento (DPA) para organizadores B2B/Edu (specs/18
 * §3.1). Ver `content/legal/dpa.ts`.
 */
export default async function DpaPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <LegalPage
      title={t("dpa.title")}
      document={dpaAnnex}
      onlyInSpanishNotice={locale === "es" ? undefined : t("onlyInSpanishNotice")}
    />
  );
}
