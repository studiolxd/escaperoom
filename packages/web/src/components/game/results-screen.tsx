"use client";

import { DoorOpen, Lightbulb, LogOut, Package, Puzzle, TimerOff, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { ReactNode } from "react";
import type { SessionSummary } from "@escaperoom/shared/session";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatDuration } from "@/lib/session-format";

/**
 * Pantalla de resultados (specs/04 §6, ticket 1.9). Consume **solo** la
 * proyección pública `SessionSummary` de `@escaperoom/shared/session`: no lee
 * `GameState`, ni códigos, ni estado interno del motor. Pinta el resultado, el
 * tiempo y las stats finales, y ofrece volver/salir (y, opcionalmente, reseña).
 */
export interface ResultsScreenProps {
  summary: SessionSummary;
  /** Destino del botón de salir (por defecto, el inicio). */
  exitHref?: string;
  /** Callback previo a la navegación de salida. */
  onExit?: () => void;
  /** Si se indica, muestra el botón de dejar reseña. */
  onReview?: () => void;
  className?: string;
}

const RESULT_ICON = {
  victory: Trophy,
  timeout: TimerOff,
  aborted: DoorOpen,
} as const;

const RESULT_TONE = {
  victory: "text-emerald-300",
  timeout: "text-amber-300",
  aborted: "text-white/60",
} as const;

export function ResultsScreen({
  summary,
  exitHref = "/",
  onExit,
  onReview,
  className,
}: ResultsScreenProps) {
  const t = useTranslations("Results");
  const Icon = RESULT_ICON[summary.result];
  const { stats } = summary;

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      className={cn(
        "absolute inset-0 z-20 grid place-items-center bg-black/70 p-4 backdrop-blur",
        className,
      )}
    >
      <div className="flex w-[min(92vw,26rem)] flex-col items-center gap-5 rounded-2xl border border-white/15 bg-slate-950/95 px-6 py-7 text-center text-white shadow-2xl">
        <Icon className={cn("size-12", RESULT_TONE[summary.result])} aria-hidden="true" />

        <header className="flex flex-col gap-1">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/50">{t("title")}</p>
          <h2 className="text-2xl font-semibold" data-testid="results-outcome">
            {t(`result.${summary.result}`)}
          </h2>
        </header>

        <div className="flex flex-col items-center gap-0.5">
          <span className="text-xs text-white/50">{t("time")}</span>
          <span className="font-mono text-3xl tabular-nums" data-testid="results-time">
            {formatDuration(stats.durationSec)}
          </span>
        </div>

        <dl className="grid w-full grid-cols-3 gap-2">
          <Stat
            icon={<Lightbulb className="size-4" aria-hidden="true" />}
            label={t("hints")}
            value={String(stats.hintsUsed)}
            testId="results-hints"
          />
          <Stat
            icon={<Puzzle className="size-4" aria-hidden="true" />}
            label={t("puzzles")}
            value={t("puzzlesValue", { solved: stats.puzzlesSolved, total: stats.puzzlesTotal })}
            testId="results-puzzles"
          />
          <Stat
            icon={<Package className="size-4" aria-hidden="true" />}
            label={t("items")}
            value={String(stats.itemsCollected)}
            testId="results-items"
          />
        </dl>

        <div className="flex w-full flex-col gap-2">
          {onReview ? (
            <Button variant="outline" onClick={onReview}>
              {t("review")}
            </Button>
          ) : null}
          <Button asChild variant="default" onClick={onExit}>
            <Link href={exitHref}>
              <LogOut data-icon="inline-start" />
              {t("exit")}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  testId,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-3">
      <span className="text-amber-200/80">{icon}</span>
      <dt className="text-[0.65rem] leading-tight text-white/50">{label}</dt>
      <dd className="font-mono text-sm tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
