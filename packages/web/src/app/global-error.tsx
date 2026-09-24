"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import "./globals.css";

/**
 * Límite de error de la raíz (F-2): si `[locale]/layout.tsx` mismo falla
 * (antes de montar `NextIntlClientProvider`), este es el único que puede
 * capturarlo. Al reemplazar todo el documento no ve el contexto de
 * next-intl (aviso de los docs de Next para `global-error`), así que lleva
 * una copia mínima traducida a mano por locale (detectado del primer
 * segmento de la URL, ya que `localePrefix: "always"` lo garantiza). Sí
 * puede importar `globals.css` (Tailwind + shadcn) aunque reemplace el
 * documento entero, así que usa los mismos componentes que el resto de la
 * app (ADR-019: ningún control nativo, sin excepciones).
 */
const COPY: Record<string, { title: string; description: string; retry: string }> = {
  es: {
    title: "Ha ocurrido un error",
    description: "Algo ha fallado al cargar la aplicación. Puedes intentarlo de nuevo.",
    retry: "Reintentar",
  },
  en: {
    title: "Something went wrong",
    description: "The application failed to load. You can try again.",
    retry: "Try again",
  },
  de: {
    title: "Es ist ein Fehler aufgetreten",
    description: "Die Anwendung konnte nicht geladen werden. Du kannst es erneut versuchen.",
    retry: "Erneut versuchen",
  },
  fr: {
    title: "Une erreur est survenue",
    description: "L'application n'a pas pu se charger. Vous pouvez réessayer.",
    retry: "Réessayer",
  },
  nl: {
    title: "Er is iets misgegaan",
    description: "De applicatie kon niet worden geladen. Je kunt het opnieuw proberen.",
    retry: "Opnieuw proberen",
  },
  pt: {
    title: "Ocorreu um erro",
    description: "A aplicação não carregou. Podes tentar novamente.",
    retry: "Tentar novamente",
  },
};

function localeForPathname(pathname: string): string {
  const locale = pathname.split("/")[1];
  return locale && locale in COPY ? locale : "es";
}

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const locale = typeof window !== "undefined" ? localeForPathname(window.location.pathname) : "es";
  const { title, description, retry: retryLabel } = COPY[locale]!;

  return (
    <html lang={locale}>
      <body className="bg-background text-foreground">
        <main className="flex min-h-dvh items-center justify-center px-4 py-16">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertTriangle />
              </EmptyMedia>
              <EmptyTitle>{title}</EmptyTitle>
              <EmptyDescription>{description}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => retry()}>{retryLabel}</Button>
            </EmptyContent>
          </Empty>
        </main>
      </body>
    </html>
  );
}
