import type { ReactNode } from "react";

/**
 * Contenedor compartido por el catálogo (`/rooms`) y la ficha de sala
 * (`/rooms/[roomId]`), incluidos sus `loading.tsx`: al vivir en un único
 * sitio (en vez de repetido en `catalog-view.tsx`, `room-detail.tsx` y cada
 * `loading.tsx`), el ancho (`max-w-6xl`) del esqueleto y el de la página ya
 * cargada nunca pueden desincronizarse.
 */
export default function RoomsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 bg-background px-4 py-8 text-foreground">
      {children}
    </main>
  );
}
