import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CookieSettingsLink } from "@/components/consent/cookie-consent-ui";

/**
 * Pie compartido por las páginas públicas de marketing (grupo de rutas
 * `(public)`): enlaces a los textos legales.
 */
export async function PublicFooter() {
  const legal = await getTranslations("Legal");

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/legal/terms" className="hover:text-foreground">
            {legal("nav.terms")}
          </Link>
          <Link href="/legal/privacy" className="hover:text-foreground">
            {legal("nav.privacy")}
          </Link>
          <Link href="/legal/dpa" className="hover:text-foreground">
            {legal("nav.dpa")}
          </Link>
          <Link href="/legal/legal-notice" className="hover:text-foreground">
            {legal("nav.legalNotice")}
          </Link>
          <Link href="/legal/cookies" className="hover:text-foreground">
            {legal("nav.cookies")}
          </Link>
          <CookieSettingsLink className="hover:text-foreground" />
        </nav>
      </div>
    </footer>
  );
}
