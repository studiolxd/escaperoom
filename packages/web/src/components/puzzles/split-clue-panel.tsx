"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { SplitCluePublicView } from "@escaperoom/shared/templates";
import { Button } from "@/components/ui/button";

/** Resultado del último envío, tal como lo devolvió el servidor. */
export type SplitClueFeedback =
  | "correct"
  | "wrong"
  | "incomplete"
  | "unavailable"
  | "already_solved"
  | "bridged"
  | "already_bridged"
  | null;

export interface SplitCluePanelProps {
  /** Única fuente de verdad del panel: la proyección pública de este punto de vista. */
  view: SplitCluePublicView;
  /** Envía la combinación al servidor; nunca se valida aquí. */
  onSubmit: (combination: string | string[]) => void;
  /** Coloca el espejo (modo solitario); solo si la definición lo admite. */
  onPlaceBridge?: () => void;
  /**
   * Símbolos candidatos para el modo `symbols` (el set público de glifos de la
   * sala). Si falta, se usan los fragmentos que este punto de vista ya ve.
   */
  symbols?: readonly string[];
  /** El host marca `true` mientras espera la respuesta del servidor. */
  pending?: boolean;
  /** Último resultado del servidor para pintar el feedback. */
  feedback?: SplitClueFeedback;
  className?: string;
}

const KEYPAD_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];

/**
 * Panel de entrada del `split_clue` (specs/06 §2.7). Es puramente
 * presentacional: solo lee `SplitCluePublicView` (los fragmentos que este punto
 * de vista tiene autorizado ver) y delega cada envío en `onSubmit`. La
 * visibilidad por jugador y la resolución viven en
 * `@escaperoom/shared/templates` (servidor), así que el panel nunca conoce los
 * fragmentos ajenos. La oclusión física de la mirilla se representa en Phaser.
 */
export function SplitCluePanel({
  view,
  onSubmit,
  onPlaceBridge,
  symbols,
  pending = false,
  feedback = null,
  className,
}: SplitCluePanelProps) {
  const t = useTranslations("SplitClue");
  const [entry, setEntry] = useState<string[]>([]);

  const solved = view.state === "solved";
  const unavailable = view.state === "locked" || view.state === "failed";
  const disabled = solved || unavailable || pending;
  const full = entry.length === view.fragmentsCount;

  const palette = useMemo(() => {
    if (symbols && symbols.length > 0) return [...new Set(symbols)];
    return [...new Set(view.visible.filter((fragment): fragment is string => fragment !== null))];
  }, [symbols, view.visible]);

  useEffect(() => {
    setEntry([]);
  }, [view.id, view.state, view.attempts, view.bridged]);

  function append(value: string) {
    if (disabled) return;
    setEntry((current) =>
      current.length >= view.fragmentsCount ? current : [...current, value],
    );
  }

  function backspace() {
    if (disabled) return;
    setEntry((current) => current.slice(0, -1));
  }

  function clear() {
    if (disabled) return;
    setEntry([]);
  }

  function submit() {
    if (disabled || !full) return;
    onSubmit(view.inputUI === "code" ? entry.join("") : [...entry]);
  }

  let status = view.inputUI === "code" ? t("promptCode") : t("promptSymbols");
  if (solved || feedback === "already_solved") status = t("solved");
  else if (view.state === "locked") status = t("locked");
  else if (view.state === "failed" || feedback === "unavailable") status = t("unavailable");
  else if (feedback === "wrong") status = t("wrong");
  else if (feedback === "incomplete") status = t("incomplete");
  else if (view.bridged) status = t("bridged");

  return (
    <section
      aria-label={t("title")}
      data-state={view.state}
      data-input-ui={view.inputUI}
      data-viewpoint={view.viewpointId}
      className={cn(
        "flex w-fit flex-col gap-4 rounded-xl border border-white/10 bg-black/60 p-4 text-white backdrop-blur",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <span className="text-xs text-white/60">
          {t("progress", { visible: view.visibleCount, total: view.fragmentsCount })}
        </span>
      </header>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-white/60">{t("viewLabel")}</span>
        <ol className="flex flex-wrap gap-2" aria-label={t("viewLabel")}>
          {view.visible.map((fragment, index) => (
            <li key={index}>
              <span
                data-slot="split-clue-visible"
                data-index={index}
                data-visible={fragment !== null}
                aria-label={fragment ?? t("hiddenLabel")}
                className={cn(
                  "grid size-10 place-items-center rounded-md border font-mono text-lg",
                  fragment !== null
                    ? "border-amber-300/60 bg-amber-300/10 text-amber-100"
                    : "border-white/10 bg-white/5 text-white/30",
                )}
              >
                {fragment ?? t("hidden")}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-white/60">{t("inputLabel")}</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("inputLabel")}>
          {Array.from({ length: view.fragmentsCount }, (_, index) => (
            <span
              key={index}
              data-slot="split-clue-slot"
              data-index={index}
              data-filled={entry[index] !== undefined}
              aria-label={t("slot", { index })}
              className={cn(
                "grid size-10 place-items-center rounded-md border font-mono text-lg",
                entry[index] !== undefined
                  ? "border-amber-300/60 bg-amber-300/10 text-amber-100"
                  : "border-white/15 bg-white/5 text-white/40",
              )}
            >
              {entry[index] ?? "·"}
            </span>
          ))}
        </div>
      </div>

      {view.inputUI === "code" ? (
        <div className="grid grid-cols-3 gap-2">
          {KEYPAD_ROWS.flat().map((digit) => (
            <Button
              key={digit}
              variant="overlay"
              size="lg"
              disabled={disabled}
              aria-label={t("symbol", { symbol: digit })}
              className="font-mono text-white hover:bg-white/10 hover:text-white"
              onClick={() => append(digit)}
            >
              {digit}
            </Button>
          ))}
          <Button
            variant="overlayGhost"
            size="lg"
            disabled={disabled}
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={clear}
          >
            {t("clear")}
          </Button>
          <Button
            variant="overlay"
            size="lg"
            disabled={disabled}
            aria-label={t("symbol", { symbol: "0" })}
            className="font-mono text-white hover:bg-white/10 hover:text-white"
            onClick={() => append("0")}
          >
            0
          </Button>
          <Button
            variant="overlayGhost"
            size="lg"
            disabled={disabled}
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={backspace}
          >
            {t("backspace")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-wrap gap-2" role="list" aria-label={t("paletteLabel")}>
            {palette.map((symbol) => (
              <li key={symbol}>
                <Button
                  variant="overlay"
                  size="sm"
                  disabled={disabled}
                  aria-label={t("symbol", { symbol })}
                  onClick={() => append(symbol)}
                >
                  {symbol}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button variant="overlayGhost" size="sm" disabled={disabled} onClick={backspace}>
              {t("backspace")}
            </Button>
            <Button variant="overlayGhost" size="sm" disabled={disabled} onClick={clear}>
              {t("clear")}
            </Button>
          </div>
        </div>
      )}

      <Button disabled={disabled || !full} onClick={submit}>
        {pending ? t("pending") : t("submit")}
      </Button>

      {onPlaceBridge && view.bridgeAvailable && !view.bridged ? (
        <Button variant="overlayGhost" size="sm" disabled={disabled} onClick={onPlaceBridge}>
          {t("bridge")}
        </Button>
      ) : null}

      <p
        aria-live="polite"
        data-tone={
          solved
            ? "success"
            : unavailable || feedback === "unavailable"
              ? "locked"
              : feedback === "wrong"
                ? "error"
                : "info"
        }
        className={cn(
          "text-center text-xs",
          solved
            ? "text-emerald-300"
            : unavailable || feedback === "unavailable"
              ? "text-amber-300"
              : feedback === "wrong"
                ? "text-red-300"
                : "text-white/60",
        )}
      >
        {pending ? t("pending") : status}
      </p>
    </section>
  );
}
