import type { CSSProperties } from "react";
import { useState } from "react";
import type { GamePlayerSnapshot } from "@escaperoom/game-runtime/session";
import { Button } from "@/components/ui/button";
import type { HudLogEntry } from "../hooks/use-hud-log";

export interface PlayersAsideProps {
  players: readonly GamePlayerSnapshot[];
  /** Fase actual (C-13): la marca de "Listo" solo tiene sentido en `lobby`. */
  phase: string;
  /** El jugador local es el anfitrión (C-13): puede expulsar a otros conectados. */
  isHost: boolean;
  onKick?: (playerId: string) => void;
  log: readonly HudLogEntry[];
  inviteUrl?: string | null;
  copied: boolean;
  onCopyInvite: () => void;
  playersLabel: string;
  youSuffix: string;
  hostSuffix: string;
  offlineSuffix: string;
  inviteLabel: string;
  copiedLabel: string;
  kickLabel: string;
  kickConfirmLabel: (player: string) => string;
  logTitle: string;
}

/**
 * Jugadores conectados + registro de la partida (real, multijugador). El
 * playtest (un único jugador local, sin invitación) no usa este aside — pinta
 * su propio registro en una esquina (F-5, "propio del playtest").
 */
export function PlayersAside({
  players,
  phase,
  isHost,
  onKick,
  log,
  inviteUrl,
  copied,
  onCopyInvite,
  playersLabel,
  youSuffix,
  hostSuffix,
  offlineSuffix,
  inviteLabel,
  copiedLabel,
  kickLabel,
  kickConfirmLabel,
  logTitle,
}: PlayersAsideProps) {
  const [pendingKickId, setPendingKickId] = useState<string | null>(null);

  return (
    <aside className="pointer-events-auto absolute left-4 top-40 z-10 flex max-h-52 w-56 flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-white backdrop-blur">
      <span className="text-[0.65rem] uppercase tracking-wide text-white/50">{playersLabel}</span>
      <ul className="flex max-h-20 flex-col gap-1 overflow-y-auto text-xs" data-testid="game-players">
        {players.map((player) => (
          <li key={player.id} className="flex items-center gap-2">
            <span
              aria-hidden
              className="tint-dot inline-block size-2.5 rounded-full"
              style={{ "--tint": player.tint } as CSSProperties}
            />
            <span className={player.connected ? "text-white/90" : "text-white/40"}>
              {player.name}
              {player.isSelf ? ` (${youSuffix})` : ""}
              {player.isHost ? ` · ${hostSuffix}` : ""}
              {player.connected ? "" : ` · ${offlineSuffix}`}
              {phase === "lobby" && player.connected && player.ready ? " ✓" : ""}
            </span>
            {isHost && !player.isSelf && player.connected && onKick ? (
              pendingKickId === player.id ? (
                <Button
                  size="xs"
                  variant="destructive"
                  data-testid={`game-kick-confirm-${player.id}`}
                  onClick={() => {
                    setPendingKickId(null);
                    onKick(player.id);
                  }}
                >
                  {kickConfirmLabel(player.name)}
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="destructive"
                  data-testid={`game-kick-${player.id}`}
                  onClick={() => setPendingKickId(player.id)}
                >
                  {kickLabel}
                </Button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      {inviteUrl ? (
        <Button size="xs" variant="overlayGhost" onClick={onCopyInvite}>
          {copied ? copiedLabel : inviteLabel}
        </Button>
      ) : null}
      <span className="mt-1 text-[0.65rem] uppercase tracking-wide text-white/50">{logTitle}</span>
      {/* Tope propio además del de arriba: el registro es lo que más crece
          dentro del aside a lo largo de la partida. */}
      <ul className="flex max-h-24 flex-col gap-0.5 overflow-y-auto text-[0.65rem] text-white/70" aria-live="polite">
        {log.length === 0 ? <li className="text-white/40">—</li> : null}
        {log.map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ul>
    </aside>
  );
}
