import type { ReactNode } from "react";
import { PublicFooter } from "@/components/layout/public-footer";
import { PublicHeader } from "@/components/layout/public-header";

/**
 * Chrome público (header + footer) compartido por el grupo de rutas
 * `(public)` y por las páginas fuera de ese grupo que también lo necesitan
 * (p. ej. `(play)/play/room/[roomId]`) sin duplicar el marcado.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <div className="flex flex-1 flex-col">{children}</div>
      <PublicFooter />
    </div>
  );
}
