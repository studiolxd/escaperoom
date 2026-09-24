"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Límite de error de la raíz (F-2): si `[locale]/layout.tsx` mismo falla
 * (antes de montar `NextIntlClientProvider`), este es el único que puede
 * capturarlo. Al reemplazar todo el documento no ve ni Tailwind ni el
 * contexto de next-intl (aviso de los docs de Next), así que lleva estilos
 * en línea y una copia mínima traducida a mano por locale (detectado del
 * primer segmento de la URL, ya que `localePrefix: "always"` lo garantiza).
 *
 * El `<button>` nativo es la excepción a "solo shadcn/ui" (ADR-019): el
 * `Button` de shadcn depende de clases de Tailwind que este documento no
 * carga (no hay `globals.css` aquí), así que renderizaría sin estilo.
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

  const locale =
    typeof window !== "undefined" ? localeForPathname(window.location.pathname) : "es";
  const { title, description, retry: retryLabel } = COPY[locale]!;

  return (
    <html lang={locale}>
      <body
        style={{
          display: "flex",
          minHeight: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: "1.5rem",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: "#020617",
          color: "#f8fafc",
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>{title}</h1>
          <p style={{ fontSize: "0.9rem", color: "#cbd5e1", margin: 0 }}>{description}</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              alignSelf: "center",
              borderRadius: "0.5rem",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "#f8fafc",
              color: "#020617",
              padding: "0.5rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {retryLabel}
          </button>
        </div>
      </body>
    </html>
  );
}
