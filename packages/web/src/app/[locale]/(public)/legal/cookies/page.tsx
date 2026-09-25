import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { cookiesPolicy } from "@/content/legal/cookies";
import { CookieSettingsLink } from "@/components/consent/cookie-consent-ui";

type Props = { params: Promise<{ locale: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Política de Cookies (specs/18). Ver `content/legal/cookies.ts`. */
export default async function CookiesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <LegalPage
      title={t("cookies.title")}
      document={cookiesPolicy}
      onlyInSpanishNotice={locale === "es" ? undefined : t("onlyInSpanishNotice")}
    >
      <CookieSettingsLink className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" />
    </LegalPage>
  );
}
