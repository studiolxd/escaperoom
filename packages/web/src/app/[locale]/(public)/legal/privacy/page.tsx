import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { privacyPolicy } from "@/content/legal/privacy";

type Props = { params: Promise<{ locale: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Política de Privacidad (specs/18 §3–§4). Ver `content/legal/privacy.ts`. */
export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <LegalPage
      title={t("privacy.title")}
      document={privacyPolicy}
      onlyInSpanishNotice={locale === "es" ? undefined : t("onlyInSpanishNotice")}
    />
  );
}
