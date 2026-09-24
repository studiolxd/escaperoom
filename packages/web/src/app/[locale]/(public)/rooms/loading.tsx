import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading UI del catálogo (F-2, F-20): `CatalogPage` hace varias consultas en
 * serie antes de poder pintar nada; sin esto el usuario ve una pantalla en
 * blanco durante ese tiempo en vez de un esqueleto inmediato.
 */
export default async function RoomsLoading() {
  const t = await getTranslations("Catalog");

  return (
    <main
      aria-busy="true"
      aria-label={t("loading")}
      className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 bg-background px-4 py-8 text-foreground"
    >
      <header className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </header>

      <Skeleton className="h-40 w-full rounded-xl" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-64 w-full rounded-xl" />
        ))}
      </div>
    </main>
  );
}
