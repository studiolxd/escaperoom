"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invitePath, sanitizePlayerName, type GameJoinTarget } from "@/lib/game-net";
import { ConnectionBadge } from "./connection-badge";
import { GameSessionShell } from "./game-session-shell";
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
  model: RuntimeModel;
  pack?: RoomScenePack;
  target: GameJoinTarget;
  title?: string;
  subtitle?: string;
  exitHref?: string;
  /** Añade `?room=<id>` a la URL al crear la partida y ofrece el link de invitación. */
  invite?: boolean;
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
  invite = false,
}: NetworkGameProps) {
  const t = useTranslations("Game");
  const locale = useLocale();
  const [draftName, setDraftName] = useState("");
  // En una sesión de evento el nombre lo fija el `joinToken` del canje.
  const [name, setName] = useState<string | null>(target.kind === "event" ? "" : null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      setDraftName(window.localStorage.getItem(NAME_STORAGE_KEY) ?? "");
    } catch {
      // Sin almacenamiento (modo privado): se pide el nombre cada vez.
    }
  }, []);

  const onJoined = useCallback(
    (roomId: string) => {
      if (!invite) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get("room") === roomId) return;
      url.searchParams.set("room", roomId);
      window.history.replaceState(window.history.state, "", url);
    },
    [invite],
  );

  const connection = useGameConnection({
    target,
    name: name ?? undefined,
    enabled: name !== null,
    onJoined,
  });

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
      <div className="grid min-h-[calc(100dvh-2rem)] place-items-center" data-testid="game-join">
        <form
          onSubmit={enter}
          className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/90 p-6 text-white shadow-xl"
        >
          <h1 className="text-lg font-semibold">{title ?? model.meta.title}</h1>
          <p className="text-sm text-white/60">
            {joining ? t("join.joinSubtitle") : t("join.createSubtitle")}
          </p>
          <Label className="flex-col items-start gap-1 text-sm">
            <span className="text-white/80">{t("join.nameLabel")}</span>
            <Input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={32}
              placeholder={t("join.namePlaceholder")}
              className="h-auto border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white placeholder:text-white/40 focus-visible:border-white/30 focus-visible:ring-1 focus-visible:ring-white/30"
            />
          </Label>
          <Button type="submit" data-testid="game-enter">
            {joining ? t("join.join") : t("join.create")}
          </Button>
        </form>
      </div>
    );
  }

  if (!connection.client) {
    const message =
      connection.status === "expired"
        ? t("status.expired")
        : connection.status === "error"
          ? t("status.error")
          : t("status.connecting");
    return (
      <div className="grid min-h-[calc(100dvh-2rem)] place-items-center text-white">
        <div className="flex flex-col items-center gap-3 text-center">
          <ConnectionBadge status={connection.status} />
          <p role={connection.status === "connecting" ? undefined : "alert"} className="text-sm">
            {message}
          </p>
          {connection.status === "error" ? (
            <Button size="sm" variant="overlay" onClick={connection.retry}>
              {t("connection.retry")}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const inviteUrl =
    invite && connection.roomId && origin
      ? `${origin}/${locale}${invitePath(connection.roomId)}`
      : null;

  return (
    <GameSessionShell
      key={connection.client.selfId}
      model={model}
      pack={pack}
      client={connection.client}
      connection={{ status: connection.status, onRetry: connection.retry }}
      inviteUrl={inviteUrl}
      title={title}
      subtitle={subtitle}
      exitHref={exitHref}
    >
      {connection.status === "expired" ? (
        <p
          role="alert"
          className="absolute inset-x-4 top-4 z-50 mx-auto w-fit rounded-lg border border-amber-300/40 bg-slate-950/95 px-4 py-2 text-sm text-amber-100"
        >
          {t("status.expired")}
        </p>
      ) : null}
      <MediaOverlay />
    </GameSessionShell>
  );
}
