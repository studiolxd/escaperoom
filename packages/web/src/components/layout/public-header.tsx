import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/**
 * Cabecera compartida por las páginas públicas de marketing (grupo de rutas
 * `(public)`): logo, catálogo, contacto y CTA de creador. El idioma y el
 * tema viven en el pie (`PublicFooter`). Las páginas de jugar una sala o de
 * creador tienen su propio chrome y no la incluyen.
 */
export async function PublicHeader() {
  const t = await getTranslations("PublicNav");

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          {t("logo")}
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost">
            <Link href="/rooms">{t("catalog")}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/contact">{t("contact")}</Link>
          </Button>
          <Button asChild>
            <Link href="/creator/onboarding">{t("createCta")}</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
