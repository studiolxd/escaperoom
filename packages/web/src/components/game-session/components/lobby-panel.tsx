"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { resolveLocalizedText, type RuntimeMeta } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { GamePlayerSnapshot } from "@escaperoom/game-runtime/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CharacterPicker } from "../character-picker";

export interface LobbyPanelProps {
  meta: RuntimeMeta;
  pack?: RoomScenePack;
  /** Portada de la sala (URL firmada), si la hay. */
  coverUrl?: string | null;
  players: readonly GamePlayerSnapshot[];
  self: GamePlayerSnapshot;
  isHost: boolean;
  onSelectCharacter: (characterId: string) => void;
  onToggleReady: (ready: boolean) => void;
  /** `force = true` es "Empezar igualmente" (nunca por debajo del mínimo, lo valida el servidor). */
  onStart: (force?: boolean) => void;
  /** C-13: solo anfitrión, expulsa a otro jugador conectado. */
  onKick?: (playerId: string) => void;
  inviteUrl?: string | null;
  copied: boolean;
  onCopyInvite: () => void;
  /** Prueba de micrófono/cámara (solo si la partida usa voz/vídeo). */
  deviceCheck?: ReactNode;
}

/**
 * Interfaz de la **sala de espera** (encargo lobby-diseño, specs/11 §4.1 y
 * specs/19): un panel lateral sobre el mapa del lobby — que el creador diseña
 * en el editor o, si no, el generado —, donde los jugadores ya aparecen y se
 * mueven con su avatar. Reúne la cabecera de la sala (portada, título,
 * descripción, dificultad, duración o "sin límite", jugadores mín.–máx.), la
 * lista de jugadores (personaje, conexión, «Listo», anfitrión, expulsar), el
 * selector de personaje (cambiarlo quita el «Listo»), la prueba de
 * micrófono/cámara, "Copiar invitación" y, solo para el anfitrión,
 * «Empezar» / «Empezar igualmente» (C-13, el servidor manda). La partida y
 * el playtest (red y local) pasan por aquí igual.
 */
export function LobbyPanel({
  meta,
  pack,
  coverUrl,
  players,
  self,
  isHost,
  onSelectCharacter,
  onToggleReady,
  onStart,
  onKick,
  inviteUrl,
  copied,
  onCopyInvite,
  deviceCheck,
}: LobbyPanelProps) {
  const t = useTranslations("Game");
  const locale = useLocale();
  const [confirmingForce, setConfirmingForce] = useState(false);
  const [pendingKickId, setPendingKickId] = useState<string | null>(null);

  const connected = players.filter((player) => player.connected);
  const allReady = connected.every((player) => player.ready);
  const belowMinimum = connected.length < meta.players.min;
  const occupied = new Set(
    players
      .filter((player) => !player.isSelf && player.connected)
      .map((player) => player.characterId),
  );
  const characterName = (characterId: string) => {
    const avatar = pack?.manifest.avatars?.find((candidate) => candidate.id === characterId);
    return avatar ? resolveLocalizedText(avatar.label, locale) : characterId;
  };

  return (
    <aside
      className="pointer-events-auto absolute bottom-4 left-4 top-20 z-20 flex w-[min(22rem,calc(100%-2rem))] flex-col gap-3 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/90 p-4 text-white shadow-xl backdrop-blur"
      data-testid="game-lobby"
      aria-label={t("lobby.title")}
    >
      <header className="flex flex-col gap-2" data-testid="lobby-header">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- portada firmada del bucket, no optimizable por Next/Image
          <img
            src={coverUrl}
            alt=""
            aria-hidden
            className="aspect-video w-full rounded-lg object-cover"
          />
        ) : null}
        <span className="text-[0.65rem] uppercase tracking-wide text-white/50">
          {t("lobby.title")}
        </span>
        <h2 className="text-base font-semibold leading-tight">{meta.title}</h2>
        {meta.description ? (
          <p className="line-clamp-4 text-xs text-white/70">{meta.description}</p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="border-white/20 text-white/80">
            {t(`lobby.difficulty.${meta.difficulty}`)}
          </Badge>
          <Badge
            variant="outline"
            className="border-white/20 text-white/80"
            data-testid="lobby-duration"
          >
            {meta.timeLimitMinutes === null
              ? t("lobby.noTimeLimit")
              : t("lobby.duration", { minutes: meta.timeLimitMinutes })}
          </Badge>
          <Badge variant="outline" className="border-white/20 text-white/80">
            {t("lobby.playersRange", { min: meta.players.min, max: meta.players.max })}
          </Badge>
        </div>
      </header>

      <Separator className="bg-white/10" />

      <section className="flex flex-col gap-1.5">
        <span className="text-[0.65rem] uppercase tracking-wide text-white/50">
          {t("lobby.players", { count: players.length })}
        </span>
        <ul className="flex flex-col gap-1 text-xs" data-testid="lobby-players">
          {players.map((player) => (
            <li
              key={player.id}
              className="flex items-center gap-2"
              data-testid={`lobby-player-${player.id}`}
            >
              <span
                aria-hidden
                className="tint-dot inline-block size-2.5 shrink-0 rounded-full"
                style={{ "--tint": player.tint } as CSSProperties}
              />
              <span
                className={`min-w-0 flex-1 truncate ${player.connected ? "text-white/90" : "text-white/40"}`}
              >
                {player.name}
                {player.isSelf ? ` (${t("lobby.you")})` : ""}
                {player.isHost ? ` · ${t("lobby.host")}` : ""}
                {player.connected ? "" : ` · ${t("lobby.offline")}`}
                <span className="block text-[0.65rem] text-white/50">
                  {characterName(player.characterId)}
                </span>
              </span>
              {player.connected && player.ready ? (
                <Badge
                  className="bg-emerald-400/20 text-emerald-100"
                  data-testid={`lobby-ready-${player.id}`}
                >
                  {t("lobby.ready")}
                </Badge>
              ) : null}
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
                    {t("lobby.kickConfirm", { player: player.name })}
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="destructive"
                    data-testid={`game-kick-${player.id}`}
                    onClick={() => setPendingKickId(player.id)}
                  >
                    {t("lobby.kick")}
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {pack ? (
        <CharacterPicker
          pack={pack}
          occupiedBy={occupied}
          value={self.characterId}
          onChange={onSelectCharacter}
        />
      ) : null}

      {deviceCheck}

      <Separator className="bg-white/10" />

      <div className="flex flex-col items-stretch gap-2 text-center">
        <Button
          size="sm"
          variant={self.ready ? "secondary" : "default"}
          data-testid="lobby-ready"
          aria-pressed={self.ready}
          onClick={() => onToggleReady(!self.ready)}
        >
          {self.ready ? t("lobby.ready") : t("lobby.markReady")}
        </Button>
        {isHost ? (
          belowMinimum ? (
            <p className="text-xs text-amber-200" data-testid="lobby-below-minimum">
              {t("lobby.belowMinimum", { min: meta.players.min })}
            </p>
          ) : confirmingForce ? (
            <div className="flex flex-col items-center gap-2 text-sm">
              <p>{t("lobby.confirmForceTitle")}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  data-testid="lobby-start-force-confirm"
                  onClick={() => {
                    setConfirmingForce(false);
                    onStart(true);
                  }}
                >
                  {t("lobby.confirmForceConfirm")}
                </Button>
                <Button size="sm" variant="overlayGhost" onClick={() => setConfirmingForce(false)}>
                  {t("lobby.confirmForceCancel")}
                </Button>
              </div>
            </div>
          ) : allReady ? (
            <Button onClick={() => onStart()} data-testid="game-start">
              {t("lobby.start")}
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <p className="text-xs text-white/60">{t("lobby.startNotReady")}</p>
              <Button
                size="sm"
                variant="overlayGhost"
                data-testid="lobby-start-force"
                onClick={() => setConfirmingForce(true)}
              >
                {t("lobby.startForce")}
              </Button>
            </div>
          )
        ) : (
          <p className="text-sm text-white/60">{t("lobby.waitingHost")}</p>
        )}
        {inviteUrl ? (
          <Button
            size="sm"
            variant="overlayGhost"
            onClick={onCopyInvite}
            data-testid="lobby-invite"
          >
            {copied ? t("lobby.copied") : t("lobby.invite")}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
