"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import * as Sentry from "@sentry/nextjs";
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
 * Límite de error del segmento `[locale]` (F-2): sin este archivo, cualquier
 * excepción sin capturar (Phaser, LiveKit, un `throw` de render) tira toda la
 * página con la pantalla de error genérica de Next, sin traducir.
 *
 * Vive dentro de `NextIntlClientProvider` (lo monta `[locale]/layout.tsx`
 * alrededor de este límite), así que puede traducir normalmente.
 *
 * Es el respaldo de rutas SIN chrome propio (creador, jugar, auth): al vivir
 * en `[locale]`, sustituye también la shell pública si el error ocurre
 * dentro de `(public)`, así que ese grupo tiene su propio `error.tsx` con
 * cabecera/pie públicos (deuda técnica, PR #120).
 */
export default function LocaleError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("ErrorPage");

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-16 text-foreground">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-12 [&_svg:not([class*='size-'])]:size-6">
            <AlertTriangle />
          </EmptyMedia>
          <EmptyTitle className="text-2xl font-bold">{t("title")}</EmptyTitle>
          <EmptyDescription>{t("description")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => retry()}>{t("retry")}</Button>
            <Button variant="outline" asChild>
              <Link href="/">{t("home")}</Link>
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </main>
  );
}
