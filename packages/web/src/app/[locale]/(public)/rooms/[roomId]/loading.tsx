import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto de la ficha de sala (F-2, F-20): sin esto, `rooms/loading.tsx`
 * (pensado para el listado) es lo único disponible y Next lo reutiliza aquí
 * también, mostrando 6 tarjetas de catálogo mientras carga una única sala.
 * El contenedor (`max-w-6xl`) lo da `rooms/layout.tsx`, compartido con el
 * listado y con la ficha ya cargada — así nunca queda un ancho distinto.
 */
export default async function RoomDetailLoading() {
  const t = await getTranslations("RoomDetail");

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className="flex w-full flex-col gap-6"
    >
      <Skeleton className="h-4 w-24" />

      <Skeleton className="aspect-[21/9] w-full rounded-xl" />

      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-border p-4 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>

      <Skeleton className="h-11 w-40 rounded-md" />

      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
