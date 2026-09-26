import type { GameConnectionStatus } from "../use-game-connection";
import { ConnectionBadge } from "../connection-badge";
import { formatDuration } from "@/lib/session-format";

export interface HudHeaderProps {
  variant: "game" | "playtest";
  title: string;
  subtitle?: string;
  roomName: string;
  controlsText: string;
  remaining: number | null;
  elapsed: number | null;
  connection?: { status: GameConnectionStatus; onRetry: () => void };
  /** "· Playtest" (solo variante playtest). */
  badgeText?: string;
  roomLabel: (room: string) => string;
}

/**
 * F-5: cabecera del HUD. La partida en red y el playtest tienen el mismo
 * bloque (título, cronómetro/cuenta atrás con #169, sala, controles) pero en
 * **orden distinto** (el playtest siempre mostró la sala antes que el
 * subtítulo, sin insignia de conexión) — se preserva tal cual para no cambiar
 * el aspecto de ninguno de los dos.
 */
export function HudHeader({
  variant,
  title,
  subtitle,
  roomName,
  controlsText,
  remaining,
  elapsed,
  connection,
  badgeText,
  roomLabel,
}: HudHeaderProps) {
  const timer =
    remaining !== null ? (
      <span className="font-mono text-xs text-amber-100" data-testid="game-timer">
        ⏳ {formatDuration(Math.ceil(remaining / 1000))}
      </span>
    ) : elapsed !== null ? (
      <span className="font-mono text-xs text-amber-100" data-testid="game-elapsed">
        ⏱️ {formatDuration(Math.floor(elapsed / 1000))}
      </span>
    ) : null;

  if (variant === "playtest") {
    return (
      <header className="pointer-events-auto flex w-fit max-w-[min(92vw,44rem)] flex-col gap-1 rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-white backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{title}</span>
          {badgeText ? <span className="text-white/50">· {badgeText}</span> : null}
          {timer}
        </div>
        <span className="text-xs text-amber-100/80" data-testid="game-room">
          {roomLabel(roomName)}
        </span>
        {subtitle ? <p className="max-w-2xl text-xs text-white/60">{subtitle}</p> : null}
        <span className="text-xs text-white/40">{controlsText}</span>
      </header>
    );
  }

  return (
    <header className="pointer-events-auto flex w-fit max-w-[min(92vw,44rem)] flex-col gap-1 rounded-xl border border-white/10 bg-black/50 px-4 py-2 text-white backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{title}</span>
        {connection ? <ConnectionBadge status={connection.status} onRetry={connection.onRetry} /> : null}
        {timer}
      </div>
      {subtitle ? <p className="max-w-2xl text-xs text-white/60">{subtitle}</p> : null}
      <span className="text-xs text-amber-100/80" data-testid="game-room">
        {roomLabel(roomName)}
      </span>
      <span className="text-xs text-white/40">{controlsText}</span>
    </header>
  );
}
