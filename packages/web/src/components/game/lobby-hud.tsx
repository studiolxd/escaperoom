"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { COLYSEUS_URL } from "@/lib/colyseus";
import { useLobbyStore, type LobbyStatus } from "@/store/lobby-store";
import { ChatPanel } from "@/components/chat/chat-panel";

const STATUS_DOT: Record<LobbyStatus, string> = {
  idle: "bg-slate-400",
  connecting: "bg-amber-400",
  connected: "bg-emerald-400",
  disconnected: "bg-slate-400",
  error: "bg-rose-500",
};

/**
 * Overlay React del lobby (specs/03 §3, ADR-019): muestra el estado de la
 * conexión y la lista de jugadores (id autoritativo + color). Igual que el HUD
 * del 0.4, no captura el puntero salvo en sus paneles.
 */
export function LobbyHud() {
  const t = useTranslations("Lobby");
  const status = useLobbyStore((state) => state.status);
  const selfId = useLobbyStore((state) => state.selfId);
  const players = useLobbyStore((state) => state.players);
  const error = useLobbyStore((state) => state.error);
  const connectionError = useLobbyStore((state) => state.connectionError);

  const list = Object.values(players).sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <header className="pointer-events-auto flex w-fit items-center gap-3 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-sm text-white backdrop-blur">
        <span className="font-medium">EscapeRoom</span>
        <span className="text-white/50">· {t("testBadge")}</span>
        <span className="flex items-center gap-1.5 text-white/80">
          <span aria-hidden className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
          {t(`status.${status}`)}
        </span>
      </header>

      <div className="flex items-end justify-between gap-4">
        <div className="pointer-events-auto flex w-fit flex-col gap-2 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
          <p className="text-xs uppercase tracking-wide text-white/50">
            {t("players", { count: list.length })}
          </p>
          <ul className="flex flex-col gap-1">
            {list.map((player) => (
              <li key={player.id} className="flex items-center gap-2 text-sm">
                <span
                  className="tint-dot size-3 rounded-full border border-white/40"
                  style={{ "--tint": player.tint } as CSSProperties}
                />
                <span className="font-mono">{player.id.slice(0, 8)}</span>
                {player.id === selfId ? <span className="text-white/50">({t("you")})</span> : null}
              </li>
            ))}
            {list.length === 0 ? <li className="text-sm text-white/50">{t("noPlayers")}</li> : null}
          </ul>

          {error ? <p className="text-xs text-rose-300">{t("serverError", { error })}</p> : null}
          {connectionError ? (
            <p className="text-xs text-rose-300">{t("connectionError", { error: connectionError })}</p>
          ) : null}

          <p className="max-w-xs border-t border-white/10 pt-2 text-xs text-white/50">
            {t("controls")} <span className="font-mono text-white/80">{COLYSEUS_URL}</span>
          </p>
        </div>

        <ChatPanel />
      </div>
    </div>
  );
}
