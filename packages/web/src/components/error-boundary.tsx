"use client";

import { useEffect } from "react";
import { catchError, type ErrorInfo } from "next/error";
import { useTranslations } from "next-intl";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { StatusOverlay } from "@/components/game-session/components/status-overlay";

/**
 * Límite de error genérico para partes del árbol que pueden fallar de forma
 * aislada sin tirar toda la página (F-2): el motor de Phaser, LiveKit o un
 * panel del editor lanzan en el render y, sin esto, se llevan por delante el
 * resto de la sesión/editor en vez de solo su propio hueco.
 *
 * `layout="overlay"` (los canvas a pantalla completa, `GameSessionCanvas`/
 * `RoomEditorCanvas`, ambos con su propia raíz `absolute inset-0`): perder
 * ESTO es perder el mundo/lienzo entero, no un widget aislado — overlay a
 * pantalla completa (`StatusOverlay`, `absolute inset-0` sobre el contenedor
 * `position:relative` que corresponda) y un botón extra para recargar la
 * página entera (Phaser o React Flow pueden quedar en un estado del que un
 * simple remonte del componente no se recupera). El texto es cosa de quien
 * llama (`title`/`description`): este componente es compartido entre
 * dominios (juego, editor, medios) que no deben depender los unos de los
 * otros para su copy — cada uno vive en su propio namespace de traducciones
 * (`Game`, `RoomEditor`...), nunca aquí.
 *
 * `layout="panel"` (por defecto: prueba de cámara/micro, voz y cámara, el
 * grafo de reglas del editor): un bloque normal, del tamaño de su propio
 * hueco — NUNCA `absolute inset-0`, que ahí se saldría de ese hueco pequeño y
 * se ancla al ancestro `position:relative` más cercano (p. ej. la `<section>`
 * grande del juego), tapando cosas que no le corresponden. Sin `title`/
 * `description` explícitos, usa un texto neutro (`ErrorBoundary.title`/
 * `.description`) que vale para cualquier panel pequeño.
 *
 * Envuelve con `catchError` (API estable de Next desde 16.3) en vez de una
 * clase `Component` propia: `retry()` reintenta el subárbol dentro de una
 * Transition preservando el estado de fuera del límite.
 */
function Fallback(
  {
    layout = "panel",
    title,
    description,
  }: { layout?: "panel" | "overlay"; title?: string; description?: string },
  { error, retry }: ErrorInfo,
) {
  const t = useTranslations("ErrorBoundary");
  const isOverlay = layout === "overlay";

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const content = (
    <div role="alert" className="flex flex-col items-center gap-3 text-center">
      <p className={isOverlay ? "text-2xl font-bold" : "text-sm font-medium"}>
        {title ?? t("title")}
      </p>
      <p
        className={
          isOverlay
            ? "max-w-sm text-sm text-muted-foreground"
            : "max-w-xs text-xs text-muted-foreground"
        }
      >
        {description ?? t("description")}
      </p>
      <div className="flex gap-2">
        <Button size={isOverlay ? "default" : "sm"} variant="secondary" onClick={() => retry()}>
          {t("retry")}
        </Button>
        {isOverlay ? (
          <Button variant="secondary" onClick={() => window.location.reload()}>
            {t("reload")}
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (isOverlay) {
    return <StatusOverlay className="p-6">{content}</StatusOverlay>;
  }
  return <div className="flex items-center justify-center p-3">{content}</div>;
}

export const ErrorBoundary = catchError(Fallback);
