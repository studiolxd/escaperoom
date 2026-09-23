import type { ReactNode } from "react";
import { PublicFooter } from "@/components/layout/public-footer";
import { PublicHeader } from "@/components/layout/public-header";

/**
 * Chrome de las páginas públicas de marketing (home, catálogo, ficha de
 * sala, contacto, legal): header y footer compartidos. Las páginas de jugar
 * una sala (`(play)`) y de creador (`(creator)`) tienen su propio chrome y
 * no pasan por este layout.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <div className="flex-1">{children}</div>
      <PublicFooter />
    </div>
  );
}
