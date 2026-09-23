import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { privacyPolicy } from "@/content/legal/privacy";

type Props = { params: Promise<{ locale: string }> };

/** Borrador legal: nunca se indexa hasta que un abogado lo apruebe. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Política de Privacidad (ticket 6.2, specs/18 §3–§4) — borrador técnico
 * pendiente de revisión legal, ver `content/legal/privacy.ts`.
 */
export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <LegalPage
      title={t("privacy.title")}
      document={privacyPolicy}
      onlyInSpanishNotice={locale === "es" ? undefined : t("onlyInSpanishNotice")}
      currentHref="/legal/privacy"
      nav={[
        { href: "/legal/terms", label: t("nav.terms") },
        { href: "/legal/privacy", label: t("nav.privacy") },
        { href: "/legal/dpa", label: t("nav.dpa") },
        { href: "/legal/legal-notice", label: t("nav.legalNotice") },
        { href: "/legal/cookies", label: t("nav.cookies") },
      ]}
    />
  );
}
