import type { ReactNode } from "react";
import { PublicShell } from "@/components/layout/public-shell";

/**
 * Chrome de las páginas públicas de marketing (home, catálogo, ficha de
 * sala, contacto, legal): header y footer compartidos (`PublicShell`). Las
 * páginas de creador (`(creator)`) tienen su propio chrome y no pasan por
 * este layout; `(play)/play/room/[roomId]` usa `PublicShell` directamente
 * (comparte el mismo chrome sin duplicarlo, aunque vive en otro grupo de
 * rutas por el guard de reaceptación de términos de `(play)/layout.tsx`).
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
