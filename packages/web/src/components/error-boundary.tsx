"use client";

import { useEffect } from "react";
import { catchError, type ErrorInfo } from "next/error";
import { useTranslations } from "next-intl";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

/**
 * Límite de error genérico para partes del árbol que pueden fallar de forma
 * aislada sin tirar toda la página (F-2): el motor de Phaser, LiveKit o un
 * panel del editor lanzan en el render y, sin esto, se llevan por delante el
 * resto de la sesión/editor en vez de solo su propio hueco.
 *
 * Envuelve con `catchError` (API estable de Next desde 16.3) en vez de una
 * clase `Component` propia: `retry()` reintenta el subárbol dentro de una
 * Transition preservando el estado de fuera del límite.
 */
function Fallback(_props: object, { error, retry }: ErrorInfo) {
  const t = useTranslations("ErrorBoundary");

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/95 p-6 text-center text-white"
    >
      <p className="text-sm font-medium">{t("title")}</p>
      <p className="max-w-sm text-xs text-white/60">{t("description")}</p>
      <Button size="sm" variant="overlay" onClick={() => retry()}>
        {t("retry")}
      </Button>
    </div>
  );
}

export const ErrorBoundary = catchError(Fallback);
