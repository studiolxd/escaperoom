import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { legalNotice } from "@/content/legal/legal-notice";

type Props = { params: Promise<{ locale: string }> };

/** Borrador legal: nunca se indexa hasta que un abogado lo apruebe. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Aviso Legal (ticket 6.2, specs/18) — borrador técnico pendiente de
 * revisión legal, ver `content/legal/legal-notice.ts`.
 */
export default async function LegalNoticePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <LegalPage
      title={t("legalNotice.title")}
      draftNotice={t("draftNotice")}
      draftDateLabel={t("draftDateLabel")}
      document={legalNotice}
      onlyInSpanishNotice={locale === "es" ? undefined : t("onlyInSpanishNotice")}
      currentHref="/legal/legal-notice"
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
