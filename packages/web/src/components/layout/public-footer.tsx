import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { CookieSettingsLink } from "@/components/consent/cookie-consent-ui";
import { Label } from "@/components/ui/label";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { ThemeSelect } from "@/components/theme/theme-select";
import { DEFAULT_THEME, isTheme, THEME_COOKIE_NAME } from "@/lib/theme";

/**
 * Pie compartido por las páginas públicas de marketing (grupo de rutas
 * `(public)`): idioma, tema y enlaces a los textos legales.
 */
export async function PublicFooter() {
  const legal = await getTranslations("Legal");
  const locale = await getTranslations("LocaleSwitcher");
  const theme = await getTranslations("ThemeToggle");
  const themeCookie = (await cookies()).get(THEME_COOKIE_NAME)?.value;
  const currentTheme = isTheme(themeCookie) ? themeCookie : DEFAULT_THEME;

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="footer-locale">{locale("label")}</Label>
            <LocaleSwitcher variant="select" id="footer-locale" />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="footer-theme">{theme("label")}</Label>
            <ThemeSelect id="footer-theme" initialTheme={currentTheme} />
          </div>
        </div>

        <nav className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/legal/legal-notice" className="hover:text-foreground">
            {legal("nav.legalNotice")}
          </Link>
          <Link href="/legal/terms" className="hover:text-foreground">
            {legal("nav.terms")}
          </Link>
          <Link href="/legal/cookies" className="hover:text-foreground">
            {legal("nav.cookies")}
          </Link>
          <Link href="/legal/privacy" className="hover:text-foreground">
            {legal("nav.privacy")}
          </Link>
          <Link href="/legal/dpa" className="hover:text-foreground">
            {legal("nav.dpa")}
          </Link>
          <CookieSettingsLink className="hover:text-foreground" />
        </nav>
      </div>
    </footer>
  );
}
