import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { dpaAnnex } from "@/content/legal/dpa";

type Props = { params: Promise<{ locale: string }> };

/** Borrador legal: nunca se indexa hasta que un abogado lo apruebe. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Anexo de encargo de tratamiento (DPA) para organizadores B2B/Edu (ticket
 * 6.2, specs/18 §3.1) — borrador técnico del TEXTO del anexo; el mecanismo de
 * aceptación (`POST /api/organizations/:id/dpa/sign`) ya existe desde el
 * ticket 5.11 y no cambia aquí. Ver `content/legal/dpa.ts`.
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
      currentHref="/legal/dpa"
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
