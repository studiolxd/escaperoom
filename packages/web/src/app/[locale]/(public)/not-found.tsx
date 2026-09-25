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
 * 404 del grupo `(public)`: al vivir en el mismo segmento que
 * `(public)/layout.tsx`, Next lo envuelve con la cabecera y el pie públicos
 * (`PublicHeader`/`PublicFooter`) en vez de sustituir todo el árbol como
 * hacía el `[locale]/not-found.tsx` genérico (deuda técnica, PR #120). Ese
 * genérico se mantiene como respaldo para el resto de grupos (creador,
 * jugar, auth), que no llevan la shell pública.
 */
export default async function PublicNotFound() {
  const t = await getTranslations("PublicNotFound");

  return (
    <main className="flex flex-1 items-center justify-center bg-background px-4 py-16 text-foreground">
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
