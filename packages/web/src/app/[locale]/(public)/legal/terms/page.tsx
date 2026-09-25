import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { termsOfService } from "@/content/legal/terms";

type Props = { params: Promise<{ locale: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Términos de Servicio (specs/18 §1–§2). Ver `content/legal/terms.ts`. */
export default async function TermsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <LegalPage
      title={t("terms.title")}
      document={termsOfService}
      onlyInSpanishNotice={locale === "es" ? undefined : t("onlyInSpanishNotice")}
    />
  );
}
