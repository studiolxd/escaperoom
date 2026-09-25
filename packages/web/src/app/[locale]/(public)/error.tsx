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
 * Límite de error del grupo `(public)`: al vivir en el mismo segmento que
 * `(public)/layout.tsx`, Next lo envuelve con la cabecera y el pie públicos
 * en vez de sustituir todo el árbol como hacía el `[locale]/error.tsx`
 * genérico (deuda técnica, PR #120). Ese genérico se mantiene como respaldo
 * para el resto de grupos (creador, jugar, auth), que no llevan la shell
 * pública.
 */
export default function PublicError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("PublicErrorPage");

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center bg-background px-4 py-16 text-foreground">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangle />
          </EmptyMedia>
          <EmptyTitle>{t("title")}</EmptyTitle>
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
