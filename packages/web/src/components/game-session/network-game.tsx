"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import type { PublicRuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sanitizePlayerName, type GameJoinTarget } from "@/lib/game-net";
import { readGameReconnect } from "@/lib/game-reconnect";
import type { IntroModel } from "@/lib/intro-model";
import { StatusOverlay } from "./components/status-overlay";
import { GameSessionShell } from "./game-session-shell";
import { useSetPlayPhase } from "./play-phase-context";
import { useGameConnection } from "./use-game-connection";

/**
 * El overlay de voz/webcam (ticket 2.2) usa `livekit-client`, que necesita
 * APIs del navegador: se carga solo en cliente, como en el lobby.
 */
const MediaOverlay = dynamic(
  () => import("@/components/game/media-overlay").then((mod) => mod.MediaOverlay),
  { ssr: false },
);

/** Nombre recordado entre partidas (conveniencia local, no es identidad). */
const NAME_STORAGE_KEY = "escaperoom:player-name";

export interface NetworkGameProps {
  model: PublicRuntimeModel;
  pack?: RoomScenePack;
  target: GameJoinTarget;
  title?: string;
  subtitle?: string;
  exitHref?: string;
  /** Sala gratis sin cuenta (punto i, "CTA Jugar"): CTA de login en `ResultsScreen`. */
  signInHref?: string;
  /**
   * Tras crear/unirse a la `GameRoom` (el id de Colyseus). Ningún flujo real
   * lo usa hoy (`RoomGame`/`EventGame` ya saben a qué room unirse por la
   * URL); lo usa la página de pruebas de reconexión E2E de `GameRoom` desnuda
   * (`(play)/dev/game-room`, DEUDA) para reflejar el id en la URL y así poder
   * recargar/reabrir la pestaña sin perder la partida.
   */
  onJoined?: (roomId: string) => void;
  /** Introducción de la sala ya resuelta en servidor (encargo lobby-diseño). */
  intro?: IntroModel | null;
  /** Portada de la sala para la cabecera del lobby. */
  coverUrl?: string | null;
  /** Link para invitar a esta partida (también a quien llega tarde). */
  inviteUrl?: string | null;
}

/**
 * Página de partida en red (fase 2): el jugador pone su nombre, se une a la
 * `GameRoom` (o a la `PlaytestRoom` del link de prueba) y juega con el runtime
 * Phaser, los paneles de las 8 plantillas, el chat de la partida (2.1) y el
 * overlay de voz/webcam (2.2), con indicador de conexión y reintento.
 */
export function NetworkGame({
  model,
  pack,
  target,
  title,
  subtitle,
  exitHref,
  signInHref,
  onJoined,
  intro,
  coverUrl,
  inviteUrl,
}: NetworkGameProps) {
  const t = useTranslations("Game");
  const [draftName, setDraftName] = useState("");
  // En una sesión de evento el nombre lo fija el `joinToken` del canje.
  const [name, setName] = useState<string | null>(target.kind === "event" ? "" : null);

  useEffect(() => {
    let stored = "";
    try {
      stored = window.localStorage.getItem(NAME_STORAGE_KEY) ?? "";
    } catch {
      // Sin almacenamiento (modo privado): se pide el nombre cada vez.
    }
    setDraftName(stored);
    // C-2 (ajuste 2026-09-25, revisión de la coordinadora sobre la PR #146):
    // recargar la página o cerrar y reabrir la pestaña a mitad de partida no
    // debe volver a pedir el nombre si ya hay una reconexión guardada para
    // esta room — si no, nunca se llega a `useGameConnection`, que es quien
    // intenta `client.reconnect()`/el `seatKey`, y el jugador entra como
    // nuevo mientras su plaza antigua queda reservada vacía hasta el fin.
    if (target.kind === "game" && target.roomId && readGameReconnect(target.roomId)) {
      setName(sanitizePlayerName(stored) ?? "");
    }
  }, [target]);

  useEffect(() => {
    // F-43..47 punto 2 (auditoría 2026-09-24): mientras el jugador rellena el
    // nombre, precarga en segundo plano los chunks de Phaser y de
    // `livekit-client` (vía `MediaOverlay`) que se montarán justo después,
    // para que la partida arranque antes al pulsar entrar.
    const idle =
      window.requestIdleCallback ?? ((cb: IdleRequestCallback) => window.setTimeout(cb, 200));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => {
      void import("./game-session-canvas");
      void import("@/components/game/media-overlay");
    });
    return () => cancelIdle(id as number);
  }, []);

  const connection = useGameConnection({
    target,
    name: name ?? undefined,
    enabled: name !== null,
    onJoined,
  });

  // Header/footer públicos y padding de `main` solo antes de entrar a jugar
  // de verdad (`PlayRoomShell`, `play/room/[roomId]/page.tsx`).
  const setPlayPhase = useSetPlayPhase();
  useEffect(() => {
    setPlayPhase(Boolean(connection.client));
    return () => setPlayPhase(false);
  }, [connection.client, setPlayPhase]);

  const enter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = sanitizePlayerName(draftName) ?? "";
    try {
      if (clean) window.localStorage.setItem(NAME_STORAGE_KEY, clean);
    } catch {
      // Ídem: recordar el nombre es opcional.
    }
    setName(clean);
  };

  if (name === null) {
    const joining = target.kind !== "game" || Boolean(target.roomId);
    return (
      <StatusOverlay data-testid="game-join">
        <form
          onSubmit={enter}
          className="flex w-full max-w-sm flex-col gap-3 rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10"
        >
          <h1 className="text-2xl font-bold">{title ?? model.meta.title}</h1>
          <p className="text-sm text-muted-foreground">
            {joining ? t("join.joinSubtitle") : t("join.createSubtitle")}
          </p>
          <Label className="flex-col items-start gap-1 text-sm">
            <span>{t("join.nameLabel")}</span>
            <Input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={32}
              placeholder={t("join.namePlaceholder")}
              className="h-auto px-2 py-1.5 text-sm"
            />
          </Label>
          <Button type="submit" data-testid="game-enter">
            {joining ? t("join.join") : t("join.create")}
          </Button>
        </form>
      </StatusOverlay>
    );
  }

  if (!connection.client) {
    const connecting = connection.status === "connecting" || connection.status === "reconnecting";
    const description =
      connection.status === "expired"
        ? t("status.expired")
        : connection.status === "error"
          ? connection.error === "room_full"
            ? t("status.roomFull")
            : t("status.error")
          : t("status.connecting");
    return (
      <StatusOverlay>
        <div className="flex flex-col items-center gap-3 text-center">
          {connecting ? (
            <>
              <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm">{description}</p>
            </>
          ) : (
            <>
              <p role="alert" className="text-2xl font-bold">
                {connection.status === "error" && connection.error === "room_full"
                  ? t("connection.roomFull")
                  : t(`connection.${connection.status}`)}
              </p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </>
          )}
          {connection.status === "error" ? (
            <Button variant="overlay" onClick={connection.retry}>
              {t("connection.retry")}
            </Button>
          ) : null}
        </div>
      </StatusOverlay>
    );
  }

  return (
    <GameSessionShell
      key={connection.client.selfId}
      model={model}
      pack={pack}
      client={connection.client}
      connection={{ status: connection.status, onRetry: connection.retry }}
      title={title}
      subtitle={subtitle}
      exitHref={exitHref}
      signInHref={signInHref}
      intro={intro}
      coverUrl={coverUrl}
      inviteUrl={inviteUrl}
    >
      {connection.status === "expired" ? (
        <p
          role="alert"
          className="absolute inset-x-4 top-4 z-50 mx-auto w-fit rounded-lg border border-amber-300/40 px-4 py-2 text-sm text-amber-100"
        >
          {t("status.expired")}
        </p>
      ) : null}
      <MediaOverlay />
    </GameSessionShell>
  );
}
