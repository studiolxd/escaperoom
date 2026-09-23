"use client";

import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { MemoryFlipOutcome, MemoryPublicView } from "@escaperoom/shared/templates";

/** Resultado del último volteo, tal como lo devolvió el servidor. */
export type MemoryFeedback = MemoryFlipOutcome | null;

export interface MemoryPanelProps {
  /** Única fuente de verdad del panel: la proyección pública (símbolos solo al voltear). */
  view: MemoryPublicView;
  /** Envía el volteo de una carta al servidor; nunca se valida aquí. */
  onFlip: (cardId: string) => void;
  /** El host marca `true` mientras espera la respuesta del servidor. */
  pending?: boolean;
  /** Último resultado del servidor para pintar el feedback. */
  feedback?: MemoryFeedback;
  /** Nombre del jugador con el turno (`per_player`); el host lo resuelve. */
  currentPlayerName?: string | null;
  /** Cierra el panel (botón superior). */
  onClose?: () => void;
  className?: string;
}

/**
 * Panel del `memory` (specs/06 §2.6). Es puramente presentacional: solo lee
 * `MemoryPublicView` y delega cada volteo en `onFlip`. El reparto de símbolos,
 * los turnos y la resolución del puzzle viven en `@escaperoom/shared/templates`
 * (servidor); el cliente jamás conoce el símbolo de una carta antes de voltearla
 * (`view.cards[].symbol === null` mientras está boca abajo).
 */
export function MemoryPanel({
  view,
  onFlip,
  pending = false,
  feedback = null,
  currentPlayerName = null,
  onClose,
  className,
}: MemoryPanelProps) {
  const t = useTranslations("Memory");

  const solved = view.state === "solved";
  const unavailable = view.state === "locked" || view.state === "failed";
  const disabled = solved || unavailable || pending;
  const progress = view.targetCount > 0 ? view.matchedCount / view.targetCount : 0;

  let status = t("prompt");
  if (solved) status = t("solved");
  else if (view.state === "locked") status = t("locked");
  else if (view.state === "failed") status = t("unavailable");
  else if (feedback === "match") status = t("match");
  else if (feedback === "mismatch" || feedback === "turn_ended") status = t("mismatch");
  else if (feedback === "already_flipped") status = t("alreadyFlipped");
  else if (feedback === "not_your_turn") status = t("notYourTurn");
  else if (feedback === "unknown_card") status = t("unknownCard");
  else if (feedback === "unavailable") status = t("unavailable");

  const turnLabel =
    view.turnMode === "per_player"
      ? t("turn", {
          name: currentPlayerName ?? view.currentPlayerId ?? t("anyPlayer"),
          flips: view.flipsRemaining,
        })
      : t("sharedTurn", { flips: view.flipsRemaining });

  return (
    <section
      aria-label={t("title")}
      data-state={view.state}
      data-turn-mode={view.turnMode}
      className={cn(
        "flex w-full max-w-sm flex-col gap-4 rounded-xl border border-white/10 bg-black/60 p-4 text-white backdrop-blur",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">
            {t("pairs", { found: view.matchedCount, total: view.targetCount })}
          </span>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded px-1 text-xs text-white/60 hover:text-white"
            >
              {t("close")}
            </button>
          ) : null}
        </div>
      </header>

      <div
        role="progressbar"
        aria-label={t("progressLabel")}
        aria-valuemin={0}
        aria-valuemax={view.targetCount}
        aria-valuenow={view.matchedCount}
        className="h-1.5 overflow-hidden rounded-full bg-white/10"
      >
        <span
          data-slot="memory-progress"
          className="block h-full rounded-full bg-amber-300/80 transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <p data-slot="memory-turn" className="text-center text-xs text-white/60">
        {turnLabel}
      </p>

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${view.cols}, minmax(0, 1fr))` }}
        role="list"
        aria-label={t("boardLabel")}
      >
        {view.cards.map((card) => {
          const faceUp = card.flipped;
          return (
            <button
              key={card.id}
              type="button"
              role="listitem"
              aria-label={faceUp ? t("cardUp", { id: card.id }) : t("cardDown", { id: card.id })}
              aria-pressed={faceUp}
              data-card-id={card.id}
              data-flipped={card.flipped}
              data-matched={card.matched}
              disabled={disabled || faceUp}
              onClick={() => onFlip(card.id)}
              className={cn(
                "grid aspect-square place-items-center rounded-lg border text-2xl transition-colors",
                card.matched
                  ? "border-emerald-300/60 bg-emerald-300/10 text-emerald-100"
                  : faceUp
                    ? "border-amber-300/60 bg-amber-300/10 text-amber-100"
                    : "border-white/15 bg-white/5 text-white/30 hover:border-amber-300/50 hover:bg-white/10",
              )}
            >
              {faceUp ? (
                <span data-slot="memory-symbol" aria-hidden>
                  {card.symbol}
                </span>
              ) : (
                <span aria-hidden>◆</span>
              )}
            </button>
          );
        })}
      </div>

      <p
        aria-live="polite"
        data-tone={
          solved
            ? "success"
            : unavailable || feedback === "unavailable"
              ? "locked"
              : feedback === "mismatch" || feedback === "turn_ended" || feedback === "not_your_turn"
                ? "error"
                : "info"
        }
        className={cn(
          "text-center text-xs",
          solved
            ? "text-emerald-300"
            : unavailable || feedback === "unavailable"
              ? "text-amber-300"
              : feedback === "mismatch" || feedback === "turn_ended" || feedback === "not_your_turn"
                ? "text-red-300"
                : "text-white/60",
        )}
      >
        {pending ? t("pending") : status}
      </p>
    </section>
  );
}
