"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { RuntimeMeta } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { GamePlayerSnapshot } from "@escaperoom/game-runtime/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  /**
   * "Todos los grupos comienzan juntos" (evento, ticket "inicio conjunto"):
   * con la opción activa, el anfitrión no ve "Empezar" — solo el organizador
   * puede arrancar la partida desde su panel.
   */
  organizerControlsStart: boolean;
  onSelectCharacter: (characterId: string) => void;
  onToggleReady: (ready: boolean) => void;
  /** `force = true` es "Empezar igualmente" (nunca por debajo del mínimo, lo valida el servidor). */
  onStart: (force?: boolean) => void;
  /** C-13: solo anfitrión, expulsa a otro jugador conectado. */
  onKick?: (playerId: string) => void;
  inviteUrl?: string | null;
  copied: boolean;
  onCopyInvite: () => void;
}

/**
 * Interfaz de la **sala de espera** (encargo lobby-diseño, specs/11 §4.1 y
 * specs/19): un panel lateral sobre el mapa del lobby — que el creador diseña
 * en el editor o, si no, el generado —, donde los jugadores ya aparecen y se
 * mueven con su avatar. Reúne la cabecera de la sala (portada, título,
 * descripción, dificultad, duración o "sin límite", jugadores mín.–máx.), la
 * lista de jugadores (personaje, conexión, «Listo», anfitrión, expulsar), el
 * selector de personaje (cambiarlo quita el «Listo»), "Copiar invitación" y,
 * solo para el anfitrión, «Empezar» / «Empezar igualmente» (C-13, el
 * servidor manda). La prueba de micrófono/cámara vive en el panel de "Audio
 * y vídeo" (`MediaOverlay`), no aquí. La partida y el playtest (red y local)
 * pasan por aquí igual.
 *
 * "Todos los grupos comienzan juntos" (evento, ticket "inicio conjunto"):
 * con `organizerControlsStart` activo, el anfitrión no ve "Empezar" en
 * absoluto — solo el mensaje de que espera al organizador (`start_game` del
 * anfitrión se rechaza igualmente en el servidor).
 */
export function LobbyPanel({
  meta,
  pack,
  coverUrl,
  players,
  self,
  isHost,
  organizerControlsStart,
  onSelectCharacter,
  onToggleReady,
  onStart,
  onKick,
  inviteUrl,
  copied,
  onCopyInvite,
}: LobbyPanelProps) {
  const t = useTranslations("Game");
  const [confirmingForce, setConfirmingForce] = useState(false);
  const [kickTarget, setKickTarget] = useState<GamePlayerSnapshot | null>(null);

  const connected = players.filter((player) => player.connected);
  const allReady = connected.every((player) => player.ready);
  const belowMinimum = connected.length < meta.players.min;
  // "Empezar sin esperar" salta la confirmación de los DEMÁS, nunca la propia
  // del anfitrión: no tendría sentido que forzara la partida sin haberse
  // confirmado él mismo.
  const hostReady = self.ready;
  const occupied = new Set(
    players
      .filter((player) => !player.isSelf && player.connected)
      .map((player) => player.characterId),
  );

  return (
    <aside
      className="pointer-events-auto absolute bottom-4 left-4 top-16 z-20 flex w-[min(22rem,calc(100%-2rem))] flex-col gap-3 overflow-y-auto rounded-md border border-border bg-card/90 p-4 text-foreground shadow-xl backdrop-blur"
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
        <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          {t("lobby.title")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-muted-foreground">
            {t(`lobby.difficulty.${meta.difficulty}`)}
          </Badge>
          <Badge variant="outline" className="text-muted-foreground" data-testid="lobby-duration">
            {meta.timeLimitMinutes === null
              ? t("lobby.noTimeLimit")
              : t("lobby.duration", { minutes: meta.timeLimitMinutes })}
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            {t("lobby.playersRange", { min: meta.players.min, max: meta.players.max })}
          </Badge>
        </div>
        <h2 className="text-base font-semibold leading-tight">{meta.title}</h2>
        {meta.description ? (
          <RoomDescription title={meta.title} description={meta.description} />
        ) : null}
      </header>

      <Separator />

      <section className="flex flex-col gap-1.5">
        <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          {t("lobby.playersOf", { count: players.length, max: meta.players.max })}
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
                className={`min-w-0 flex-1 truncate ${player.connected ? "text-foreground" : "text-muted-foreground"}`}
              >
                {player.name}
                {player.isSelf ? ` (${t("lobby.you")})` : ""}
                {player.isHost ? ` · ${t("lobby.host")}` : ""}
                {player.connected ? "" : ` · ${t("lobby.offline")}`}
                {player.connected && player.ready ? (
                  <Badge
                    className="ml-1.5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                    data-testid={`lobby-ready-${player.id}`}
                  >
                    {t("lobby.ready")}
                  </Badge>
                ) : null}
              </span>
              {player.isSelf ? (
                <Button
                  size="default"
                  variant={player.ready ? "secondary" : "default"}
                  data-testid="lobby-ready"
                  aria-pressed={player.ready}
                  onClick={() => onToggleReady(!player.ready)}
                >
                  {player.ready ? t("lobby.ready") : t("lobby.markReady")}
                </Button>
              ) : null}
              {isHost && !player.isSelf && player.connected && onKick ? (
                <Button
                  size="default"
                  variant="destructive"
                  className="bg-destructive text-white hover:bg-destructive/90"
                  data-testid={`game-kick-${player.id}`}
                  onClick={() => setKickTarget(player)}
                >
                  {t("lobby.kick")}
                </Button>
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

      <div className="mt-auto flex flex-col items-stretch gap-2 text-center">
        {isHost && organizerControlsStart ? (
          <p className="text-sm text-muted-foreground" data-testid="lobby-waiting-organizer">
            {t("lobby.waitingOrganizer")}
          </p>
        ) : isHost ? (
          belowMinimum ? (
            <p className="text-xs text-amber-700 dark:text-amber-200" data-testid="lobby-below-minimum">
              {t("lobby.belowMinimum", { min: meta.players.min })}
            </p>
          ) : !hostReady ? (
            <p className="text-xs text-amber-700 dark:text-amber-200" data-testid="lobby-host-not-ready">
              {t("lobby.hostMustConfirm")}
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
                <Button size="sm" variant="ghost" onClick={() => setConfirmingForce(false)}>
                  {t("lobby.confirmForceCancel")}
                </Button>
              </div>
            </div>
          ) : allReady ? (
            <Button onClick={() => onStart()} data-testid="game-start">
              {t("lobby.start")}
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-destructive">{t("lobby.startNotReady")}</p>
              <Button
                size="default"
                className="w-full"
                data-testid="lobby-start-force"
                onClick={() => setConfirmingForce(true)}
              >
                {t("lobby.startForce")}
              </Button>
            </div>
          )
        ) : (
          <p className="text-xs text-muted-foreground">{t("lobby.waitingHost")}</p>
        )}
      </div>

      {inviteUrl ? (
        <Button size="default" variant="ghost" onClick={onCopyInvite} data-testid="lobby-invite">
          {copied ? t("lobby.copied") : t("lobby.invite")}
        </Button>
      ) : null}

      <Dialog open={kickTarget !== null} onOpenChange={(open) => !open && setKickTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("lobby.kickTitle")}</DialogTitle>
            <DialogDescription>
              {kickTarget ? t("lobby.kickConfirm", { player: kickTarget.name }) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setKickTarget(null)}>
              {t("lobby.kickCancel")}
            </Button>
            <Button
              variant="destructive"
              className="bg-destructive text-white hover:bg-destructive/90"
              data-testid={kickTarget ? `game-kick-confirm-${kickTarget.id}` : undefined}
              onClick={() => {
                if (!kickTarget) return;
                onKick?.(kickTarget.id);
                setKickTarget(null);
              }}
            >
              {t("lobby.kick")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

/**
 * Descripción de la sala recortada a 5 líneas (`line-clamp-5`): sin una
 * medida nativa de "¿se ha truncado?", comparamos `scrollHeight` contra
 * `clientHeight` tras montar — solo entonces aparece "Leer más", que abre el
 * texto completo en un `Dialog`.
 */
function RoomDescription({ title, description }: { title: string; description: string }) {
  const t = useTranslations("Game");
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el) setTruncated(el.scrollHeight > el.clientHeight + 1);
  }, [description]);

  return (
    <>
      <p ref={ref} className="line-clamp-5 text-xs text-muted-foreground">
        {description}
      </p>
      {truncated ? (
        <Button
          variant="link"
          className="h-auto self-start p-0 text-xs underline-offset-2"
          data-testid="lobby-description-more"
          onClick={() => setOpen(true)}
        >
          {t("lobby.readMore")}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <p className="whitespace-pre-line text-sm text-muted-foreground">{description}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
