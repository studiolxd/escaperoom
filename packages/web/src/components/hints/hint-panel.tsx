"use client";

import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { HintPublicView, HintRequestErrorCode } from "@escaperoom/shared/hints";
import { Button } from "@/components/ui/button";

export interface HintPanelProps {
  /** Proyección pública del sistema de pistas (tickets ya revelados + contador). */
  view: HintPublicView;
  /** Puzzle del panel; debe existir en `view.puzzles`. */
  puzzleId: string;
  /** Pide la siguiente pista al servidor; el descuento vive en `shared`. */
  onRequest: (puzzleId: string) => void;
  /** El host marca `true` mientras espera la respuesta del servidor. */
  pending?: boolean;
  /** Deshabilita el botón (p. ej. fuera de la fase `playing`). */
  disabled?: boolean;
  /** Último rechazo del servidor para pintar el mensaje. */
  error?: HintRequestErrorCode | null;
  className?: string;
}

/**
 * Panel de pistas (specs/04 §6, ticket 1.8). Es puramente presentacional: lee
 * los tiers ya revelados de `HintPublicView` y delega `pedir pista` en
 * `onRequest`. El descuento del contador, el coste y la resolución de
 * `LocalizedText` viven en `@escaperoom/shared/hints` (servidor).
 */
export function HintPanel({
  view,
  puzzleId,
  onRequest,
  pending = false,
  disabled = false,
  error = null,
  className,
}: HintPanelProps) {
  const t = useTranslations("Hints");

  const puzzle = view.puzzles.find((candidate) => candidate.puzzleId === puzzleId);
  const hints = puzzle?.hints ?? [];
  const nextCost = puzzle?.nextCost ?? null;
  const available = puzzle !== undefined;
  const exhausted = available && nextCost === null;
  const canRequest = nextCost !== null && !pending && !disabled;

  return (
    <section
      aria-label={t("title")}
      className={cn(
        "flex w-72 flex-col gap-3 rounded-xl border border-white/10 bg-black/60 p-4 text-white backdrop-blur",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <p className="text-xs text-amber-200" data-testid="hint-remaining">
          {t("remaining", { count: view.remaining })}
        </p>
      </header>

      <ol className="flex flex-col gap-2" data-testid="hint-tiers">
        {hints.length === 0 ? (
          <li className="text-xs text-white/50">{t("empty")}</li>
        ) : (
          hints.map((hint) => (
            <li key={hint.id} className="rounded-lg border border-white/10 bg-white/5 p-2">
              <p className="text-[0.7rem] font-medium tracking-wide text-amber-200 uppercase">
                {t("tier", { tier: hint.tier })}
              </p>
              <p className="text-xs text-white/85">{hint.text}</p>
            </li>
          ))
        )}
      </ol>

      <Button
        variant="overlay"
        size="lg"
        disabled={!canRequest}
        onClick={() => onRequest(puzzleId)}
      >
        {pending
          ? t("pending")
          : nextCost === null
            ? t("request")
            : t("requestCost", { cost: nextCost })}
      </Button>

      <p aria-live="polite" className="text-center text-xs text-amber-300">
        {!available
          ? t("unavailable")
          : error
            ? t(`errors.${error}`, { cost: nextCost ?? 0, remaining: view.remaining })
            : exhausted
              ? t("exhausted")
              : ""}
      </p>
    </section>
  );
}
