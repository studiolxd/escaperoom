import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { cookiesPolicy } from "@/content/legal/cookies";
import { CookieSettingsLink } from "@/components/consent/cookie-consent-ui";

type Props = { params: Promise<{ locale: string }> };

/** Borrador legal: nunca se indexa hasta que un abogado lo apruebe. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Política de Cookies (ticket 6.2, specs/18) — borrador técnico pendiente de
 * revisión legal, ver `content/legal/cookies.ts`.
 */
export default async function CookiesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <LegalPage
      title={t("cookies.title")}
      document={cookiesPolicy}
      onlyInSpanishNotice={locale === "es" ? undefined : t("onlyInSpanishNotice")}
      currentHref="/legal/cookies"
      nav={[
        { href: "/legal/terms", label: t("nav.terms") },
        { href: "/legal/privacy", label: t("nav.privacy") },
        { href: "/legal/dpa", label: t("nav.dpa") },
        { href: "/legal/legal-notice", label: t("nav.legalNotice") },
        { href: "/legal/cookies", label: t("nav.cookies") },
      ]}
    >
      <CookieSettingsLink className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" />
    </LegalPage>
  );
}
