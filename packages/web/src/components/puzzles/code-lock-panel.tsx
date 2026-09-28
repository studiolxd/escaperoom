"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { CodeLockPublicView } from "@escaperoom/shared/templates";
import { Button } from "@/components/ui/button";

/** Resultado del último intento, tal como lo devolvió el servidor. */
export type CodeLockFeedback =
  "correct" | "wrong" | "locked_out" | "unavailable" | "already_solved" | null;

export interface CodeLockPanelProps {
  /** Única fuente de verdad del panel: la proyección pública (sin código). */
  view: CodeLockPublicView;
  /** Envía el intento al servidor; nunca se valida aquí. */
  onAttempt: (code: string) => void;
  /** El host marca `true` mientras espera la respuesta del servidor. */
  pending?: boolean;
  /** Último resultado del servidor para pintar el feedback. */
  feedback?: CodeLockFeedback;
}

const KEYPAD_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];

/**
 * Teclado del `code_lock` (specs/06 §2.2). Es puramente presentacional: solo
 * lee `CodeLockPublicView` y delega cada intento en `onAttempt`. La validación
 * del código y el bloqueo viven en `@escaperoom/shared/templates` (servidor).
 */
export function CodeLockPanel({
  view,
  onAttempt,
  pending = false,
  feedback = null,
}: CodeLockPanelProps) {
  const t = useTranslations("CodeLock");
  const [entry, setEntry] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const lockedRemainingMs =
    view.lockedUntil !== null && view.lockedUntil > now ? view.lockedUntil - now : 0;
  const lockedOut = lockedRemainingMs > 0;
  const solved = view.state === "solved";
  const unavailable = view.state === "locked" || view.state === "failed";
  const disabled = solved || lockedOut || unavailable || pending;

  useEffect(() => {
    if (!lockedOut) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [lockedOut]);

  useEffect(() => {
    setEntry("");
  }, [view.id, view.state, view.attempts, lockedOut]);

  function pressDigit(digit: string) {
    if (disabled) return;
    setEntry((current) => (current.length >= view.length ? current : current + digit));
  }

  function backspace() {
    if (disabled) return;
    setEntry((current) => current.slice(0, -1));
  }

  function clear() {
    if (disabled) return;
    setEntry("");
  }

  function submit() {
    if (disabled || entry.length !== view.length) return;
    onAttempt(entry);
  }

  const seconds = Math.ceil(lockedRemainingMs / 1_000);
  let status = t("prompt", { length: view.length });
  if (solved) status = t("solved");
  else if (lockedOut) status = t("lockedOut", { seconds });
  else if (view.state === "locked") status = t("locked");
  else if (view.state === "failed") status = t("unavailable");
  else if (feedback === "wrong")
    status = view.unlimited ? t("wrongUnlimited") : t("wrong", { count: view.remainingAttempts });
  else if (feedback === "locked_out") status = t("lockedOut", { seconds: view.lockoutSec });
  else if (feedback === "unavailable") status = t("unavailable");

  return (
    <section
      aria-label={t("title")}
      className="flex w-fit flex-col gap-4 rounded-xl border border-border bg-card/95 p-4 text-foreground backdrop-blur"
    >
      <header className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">
          {view.unlimited
            ? t("attemptsUnlimited", { used: view.attempts })
            : t("attempts", { used: view.attempts, max: view.maxAttempts })}
        </p>
      </header>

      <div
        className="flex justify-center gap-2"
        role="group"
        aria-label={t("prompt", { length: view.length })}
      >
        {Array.from({ length: view.length }, (_, index) => (
          <span
            key={index}
            data-filled={entry[index] !== undefined}
            className={cn(
              "grid size-10 place-items-center rounded-md border font-mono text-lg",
              entry[index] !== undefined
                ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:border-amber-300/60 dark:bg-amber-300/10 dark:text-amber-100"
                : "border-border bg-muted/50 text-muted-foreground",
            )}
          >
            {entry[index] ?? "·"}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYPAD_ROWS.flat().map((digit) => (
          <Button
            key={digit}
            variant="secondary"
            size="lg"
            disabled={disabled}
            aria-label={t("digit", { digit })}
            className="font-mono"
            onClick={() => pressDigit(digit)}
          >
            {digit}
          </Button>
        ))}
        <Button variant="ghost" size="lg" disabled={disabled} onClick={clear}>
          {t("clear")}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          disabled={disabled}
          aria-label={t("digit", { digit: "0" })}
          className="font-mono"
          onClick={() => pressDigit("0")}
        >
          0
        </Button>
        <Button variant="ghost" size="lg" disabled={disabled} onClick={backspace}>
          {t("backspace")}
        </Button>
      </div>

      <Button disabled={disabled || entry.length !== view.length} onClick={submit}>
        {pending ? t("pending") : t("submit")}
      </Button>

      <p
        aria-live="polite"
        data-tone={
          solved
            ? "success"
            : lockedOut || unavailable
              ? "locked"
              : feedback === "wrong"
                ? "error"
                : "info"
        }
        className={cn(
          "text-center text-xs",
          solved
            ? "text-emerald-700 dark:text-emerald-300"
            : lockedOut || unavailable
              ? "text-amber-700 dark:text-amber-300"
              : feedback === "wrong"
                ? "text-red-600 dark:text-red-300"
                : "text-muted-foreground",
        )}
      >
        {status}
      </p>
    </section>
  );
}
