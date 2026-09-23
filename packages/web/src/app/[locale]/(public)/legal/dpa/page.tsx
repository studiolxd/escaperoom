import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { dpaTemplate } from "@/content/legal/dpa-template";

type Props = { params: Promise<{ locale: string }> };

/** Borrador legal: nunca se indexa hasta que un abogado lo apruebe. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Plantilla de DPA para organizadores B2B/Edu (ticket 6.2, specs/18 §3.1) —
 * borrador técnico del TEXTO de la plantilla; el mecanismo de firma
 * (`POST /api/organizations/:id/dpa/sign`) ya existe desde el ticket 5.11 y
 * no cambia aquí. Ver `content/legal/dpa-template.ts`.
 */
export default async function DpaTemplatePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <LegalPage
      title={t("dpa.title")}
      draftNotice={t("draftNotice")}
      draftDateLabel={t("draftDateLabel")}
      document={dpaTemplate}
      onlyInSpanishNotice={locale === "es" ? undefined : t("onlyInSpanishNotice")}
      currentHref="/legal/dpa"
      nav={[
        { href: "/legal/terms", label: t("nav.terms") },
        { href: "/legal/privacy", label: t("nav.privacy") },
        { href: "/legal/dpa", label: t("nav.dpa") },
      ]}
    />
  );
}
