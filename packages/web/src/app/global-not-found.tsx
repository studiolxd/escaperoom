import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { CompassIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "No hemos encontrado esta página",
  description: "El enlace puede estar roto o la página ya no existe.",
};

/**
 * 404 global (auditoría 2026-09-24, DEUDA "404 de URLs que no existen"): la
 * red de seguridad para URLs que ni siquiera llegan a `[locale]` — sin
 * prefijo de idioma y que `proxy.ts` no redirige porque su matcher trata
 * cualquier segmento con un punto como un asset estático (p. ej.
 * `/v1.2-notas`). `[locale]/(public)/[...rest]/page.tsx` cubre el resto (con
 * locale válido).
 *
 * Al no haber `app/layout.tsx` raíz (el root efectivo es
 * `[locale]/layout.tsx`, un segmento dinámico), Next no admite un
 * `app/not-found.tsx` normal para esto — `global-not-found` es la vía
 * documentada para ese caso exacto (ver `next.config.ts`). Bypassa TODO el
 * árbol de layouts (no solo el de `[locale]`), así que trae su propio
 * `<html>/<body>` y no puede usar `next-intl` (no hay locale que resolver):
 * copia en español (idioma por defecto, `DEFAULT_LOCALE`) fija, con
 * `next/link` normal en vez del `Link` de `@/i18n/navigation`.
 */
export default function GlobalNotFound() {
  return (
    <html lang="es" className={cn("font-sans", geist.variable)}>
      <body className="bg-background text-foreground">
        <main className="flex min-h-dvh items-center justify-center px-4 py-16">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CompassIcon />
              </EmptyMedia>
              <EmptyTitle>No hemos encontrado esta página</EmptyTitle>
              <EmptyDescription>
                El enlace puede estar roto o la página ya no existe.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button asChild>
                  <Link href="/es">Ir al inicio</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/es/rooms">Ver el catálogo</Link>
                </Button>
              </div>
            </EmptyContent>
          </Empty>
        </main>
      </body>
    </html>
  );
}
