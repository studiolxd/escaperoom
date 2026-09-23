"use client";

import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { GameConnectionStatus } from "./use-game-connection";

const DOT: Record<GameConnectionStatus, string> = {
  idle: "bg-slate-400",
  connecting: "bg-amber-400 animate-pulse",
  connected: "bg-emerald-400",
  reconnecting: "bg-amber-400 animate-pulse",
  disconnected: "bg-rose-500",
  expired: "bg-slate-400",
  error: "bg-rose-500",
};

/** Estados desde los que tiene sentido volver a unirse a la partida. */
const RETRYABLE = new Set<GameConnectionStatus>(["disconnected", "error"]);

/**
 * Indicador de conexión con el servidor de partidas (fase 2): conectando,
 * en línea, reconectando, desconectado o error, y el botón de reintento que
 * vuelve a unirse a la misma partida.
 */
export function ConnectionBadge({
  status,
  onRetry,
  className,
}: {
  status: GameConnectionStatus;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations("Game.connection");
  return (
    <span
      role="status"
      data-testid="game-connection"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[0.7rem] text-white/80",
        className,
      )}
    >
      <span aria-hidden className={cn("size-2 rounded-full", DOT[status])} />
      {t(status)}
      {onRetry && RETRYABLE.has(status) ? (
        <Button size="xs" variant="overlay" onClick={onRetry} className="h-5 px-2 text-[0.65rem]">
          {t("retry")}
        </Button>
      ) : null}
    </span>
  );
}
