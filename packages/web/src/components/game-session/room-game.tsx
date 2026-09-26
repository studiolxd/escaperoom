"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { PublicRuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { IntroModel } from "@/lib/intro-model";
import { readGameTokenFromHash } from "@/lib/game-net";
import { NetworkGame } from "./network-game";

/** El token se guarda por pestaña para reintentos y recargas (no en `localStorage`). */
const tokenKey = (roomId: string) => `escaperoom:game-token:${roomId}`;

/**
 * Entrada a una sala REAL comprada o gratis (puntos f/i de "CTA Jugar",
 * `docs/DEUDA.md`): el CTA de la ficha deja el `gameToken` en el fragmento de
 * la URL (`/play/room/<roomId>#gameToken=…`), igual que `EventGame` con el
 * canje de eventos; aquí se recoge, se quita de la barra de direcciones y se
 * usa para crear o unirse a la `GameRoom`. `joinRoomId` (query, no sensible)
 * solo cuando hay una partida "en curso" a la que unirse.
 */
export function RoomGame({
  model,
  pack,
  roomId,
  joinRoomId,
  subtitle,
  signInHref,
  intro,
  coverUrl,
}: {
  model: PublicRuntimeModel;
  pack?: RoomScenePack;
  roomId: string;
  joinRoomId?: string;
  subtitle?: string;
  /** Sala gratis sin cuenta (punto i, "CTA Jugar"): CTA de login en `ResultsScreen`. */
  signInHref?: string;
  /** Introducción de la sala (encargo lobby-diseño). */
  intro?: IntroModel | null;
  /** Portada de la sala para la cabecera del lobby. */
  coverUrl?: string | null;
}) {
  const t = useTranslations("Game");
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [joinedRoomId, setJoinedRoomId] = useState<string | null>(null);
  const onJoined = useCallback((id: string) => setJoinedRoomId(id), []);

  // "Copiar invitación" (encargo lobby-diseño): la misma página con
  // `?join=<room de Colyseus>` y el `gameToken` en el fragmento (nunca en la
  // query: no llega al servidor web ni a sus logs). Quien lo abra entra en
  // ESTA partida — también si ya empezó (entrada tardía: lobby, introducción
  // y 3-2-1), hasta el máximo de jugadores; un expulsado no puede volver.
  const inviteUrl = useMemo(() => {
    if (!token || !joinedRoomId || typeof window === "undefined") return null;
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("join", joinedRoomId);
    url.hash = `gameToken=${encodeURIComponent(token)}`;
    return url.toString();
  }, [token, joinedRoomId]);

  useEffect(() => {
    const fromHash = readGameTokenFromHash(window.location.hash);
    if (fromHash) {
      try {
        window.sessionStorage.setItem(tokenKey(roomId), fromHash);
      } catch {
        // Sin almacenamiento: el token vale para esta carga de la página.
      }
      const url = new URL(window.location.href);
      url.hash = "";
      window.history.replaceState(window.history.state, "", url);
      setToken(fromHash);
      return;
    }
    try {
      setToken(window.sessionStorage.getItem(tokenKey(roomId)));
    } catch {
      setToken(null);
    }
  }, [roomId]);

  // F-36: objeto estable por `(token, joinRoomId)` — sin memoizar, un objeto
  // nuevo en cada render de `RoomGame` reprocesaba el `gameToken`
  // (`JSON.stringify` en `use-game-connection.ts`) aunque no cambiara nada.
  const target = useMemo(
    () => ({ kind: "game" as const, gameToken: token ?? "", ...(joinRoomId ? { roomId: joinRoomId } : {}) }),
    [token, joinRoomId],
  );

  if (token === undefined) {
    return <p className="p-4 text-sm text-white/70">{t("status.connecting")}</p>;
  }
  if (!token) {
    return (
      <p role="alert" className="p-4 text-sm text-white/70">
        {t("room.missingToken")}
      </p>
    );
  }
  return (
    <NetworkGame
      model={model}
      pack={pack}
      target={target}
      subtitle={subtitle}
      signInHref={signInHref}
      onJoined={onJoined}
      intro={intro}
      coverUrl={coverUrl}
      inviteUrl={inviteUrl}
    />
  );
}
