import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { legalNotice } from "@/content/legal/legal-notice";

type Props = { params: Promise<{ locale: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Aviso Legal (specs/18). Ver `content/legal/legal-notice.ts`. */
export default async function LegalNoticePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <LegalPage
      title={t("legalNotice.title")}
      document={legalNotice}
      onlyInSpanishNotice={locale === "es" ? undefined : t("onlyInSpanishNotice")}
    />
  );
}
