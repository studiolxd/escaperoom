import { CompassIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * 404 del segmento `[locale]` (F-2): antes no había `not-found.tsx` propio y
 * `notFound()` (p. ej. `layout.tsx` con un locale inválido, o una sala que no
 * existe) caía en la página genérica de Next, sin traducir.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations("NotFound");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16 text-foreground">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CompassIcon />
          </EmptyMedia>
          <EmptyTitle>{t("title")}</EmptyTitle>
          <EmptyDescription>{t("description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild>
              <Link href="/">{t("home")}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/rooms">{t("browseCatalog")}</Link>
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </main>
  );
}
