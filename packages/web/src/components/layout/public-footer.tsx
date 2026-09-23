import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * Pie compartido por las páginas públicas de marketing (grupo de rutas
 * `(public)`): enlaces a los textos legales y aviso de derechos.
 */
export async function PublicFooter() {
  const t = await getTranslations("PublicNav");
  const legal = await getTranslations("Legal");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{t("footer.tagline")}</p>

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
        </nav>

        <p>{t("footer.rights", { year })}</p>
      </div>
    </footer>
  );
}
