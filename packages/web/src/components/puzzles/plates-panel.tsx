"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { PlateOutcome, SimultaneousPlatesPublicView } from "@escaperoom/shared/templates";
import { Button } from "@/components/ui/button";

/** Resultado de la última activación, tal como lo devolvió el servidor. */
export type PlatesFeedback = PlateOutcome | null;

export interface PlatesPanelProps {
  /** Única fuente de verdad del panel: la proyección pública (sin el puente). */
  view: SimultaneousPlatesPublicView;
  /** Envía activar/desactivar una placa al servidor; nunca se valida aquí. */
  onTogglePlate?: (objectId: string, active: boolean) => void;
  /** Coloca el objeto-puente (modo solitario); solo si la definición lo admite. */
  onPlaceBridge?: () => void;
  /** El host marca `true` mientras espera la respuesta del servidor. */
  pending?: boolean;
  /** Último resultado del servidor para pintar el feedback. */
  feedback?: PlatesFeedback;
  className?: string;
  /**
   * Reloj que se consulta cada 250 ms para la cuenta atrás (F-43..47 punto 1).
   * Por defecto `Date.now`, correcto en local/preview (sin servidor con el que
   * desincronizarse). En partida en red, quien monta el panel debe pasar el
   * reloj del servidor (`snapshot.clock`) compensado con el desfase del
   * jugador: con el reloj del ordenador adelantado o atrasado, `Date.now()` a
   * secas no coincidiría con la ventana real que resuelve el servidor.
   */
  getNow?: () => number;
}

/**
 * Panel/indicador del `simultaneous_plates` (specs/06 §2.3). Es puramente
 * presentacional: solo lee `SimultaneousPlatesPublicView` y delega cada
 * activación en `onTogglePlate`. La ventana temporal y la resolución viven en
 * `@escaperoom/shared/templates` (servidor). La cuenta atrás se calcula aquí
 * sobre `windowEndsAt` (tiempo lógico del servidor), sin reimplementar reglas.
 */
export function PlatesPanel({
  view,
  onTogglePlate,
  onPlaceBridge,
  pending = false,
  feedback = null,
  className,
  getNow = Date.now,
}: PlatesPanelProps) {
  const t = useTranslations("SimultaneousPlates");
  const [now, setNow] = useState(getNow);

  const solved = view.state === "solved";
  const unavailable = view.state === "locked" || view.state === "failed";
  const disabled = solved || unavailable || pending;

  const remainingMs =
    view.windowEndsAt !== null && view.windowEndsAt > now ? view.windowEndsAt - now : 0;
  const windowOpen = remainingMs > 0;
  const progress = view.totalCount > 0 ? view.activeCount / view.totalCount : 0;

  useEffect(() => {
    if (solved || view.windowEndsAt === null) return;
    const timer = window.setInterval(() => setNow(getNow()), 250);
    return () => window.clearInterval(timer);
  }, [solved, view.windowEndsAt, getNow]);

  const seconds = Math.ceil(remainingMs / 1_000);
  let status = t("prompt");
  if (solved) status = t("solved");
  else if (view.state === "locked") status = t("locked");
  else if (view.state === "failed") status = t("unavailable");
  else if (feedback === "expired") status = t("expired");
  else if (feedback === "already_active") status = t("alreadyActive");
  else if (feedback === "unavailable") status = t("unavailable");
  else if (windowOpen) status = t("countdown", { seconds });

  return (
    <section
      aria-label={t("title")}
      data-state={view.state}
      data-hold-mode={view.holdMode}
      className={cn(
        "flex w-fit flex-col gap-4 rounded-xl border border-white/10 bg-black/60 p-4 text-white backdrop-blur",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <span className="text-xs text-white/60">
          {t("progress", { active: view.activeCount, total: view.totalCount })}
        </span>
      </header>

      <div
        role="progressbar"
        aria-label={t("progressLabel")}
        aria-valuemin={0}
        aria-valuemax={view.totalCount}
        aria-valuenow={view.activeCount}
        className="h-1.5 overflow-hidden rounded-full bg-white/10"
      >
        <span
          data-slot="plates-progress"
          className="progress-fill block h-full rounded-full bg-amber-300/80 transition-[width] duration-150"
          style={{ "--progress": `${Math.round(progress * 100)}%` } as CSSProperties}
        />
      </div>

      {view.windowEndsAt !== null && !solved ? (
        <p
          data-slot="plates-countdown"
          data-open={windowOpen}
          className={cn("text-center text-xs", windowOpen ? "text-amber-200" : "text-white/50")}
        >
          {windowOpen ? t("countdown", { seconds }) : t("windowClosed")}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2" aria-label={t("platesLabel")}>
        {view.plates.map((plate) => (
          <li key={plate.objectId}>
            <Button
              variant="overlay"
              size="sm"
              className="w-full justify-between"
              aria-label={t("plate", { id: plate.objectId })}
              aria-pressed={plate.active}
              data-plate-id={plate.objectId}
              data-active={plate.active}
              data-bridged={plate.bridged}
              disabled={disabled || plate.bridged}
              onClick={() => onTogglePlate?.(plate.objectId, !plate.active)}
            >
              <span className="font-mono text-xs">{plate.objectId}</span>
              <span className={cn("text-xs", plate.active ? "text-amber-100" : "text-white/50")}>
                {plate.bridged ? t("bridged") : plate.active ? t("active") : t("inactive")}
              </span>
            </Button>
          </li>
        ))}
      </ul>

      {onPlaceBridge ? (
        <Button
          variant="overlayGhost"
          size="sm"
          disabled={disabled}
          onClick={onPlaceBridge}
        >
          {t("placeBridge")}
        </Button>
      ) : null}

      <p
        aria-live="polite"
        data-tone={
          solved
            ? "success"
            : unavailable || feedback === "expired" || feedback === "unavailable"
              ? "locked"
              : "info"
        }
        className={cn(
          "text-center text-xs",
          solved
            ? "text-emerald-300"
            : unavailable || feedback === "expired" || feedback === "unavailable"
              ? "text-amber-300"
              : "text-white/60",
        )}
      >
        {pending ? t("pending") : status}
      </p>
    </section>
  );
}
