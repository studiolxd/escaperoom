"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { PublicRuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { Pack3D } from "@/lib/game-model";
import { readJoinTokenFromHash } from "@/lib/game-net";
import { AlertStatus, LoadingStatus } from "./components/status-overlay";
import { NetworkGame } from "./network-game";

/** El token se guarda por pestaña para reintentos y recargas (no en `localStorage`). */
const tokenKey = (sessionId: string) => `escaperoom:join-token:${sessionId}`;

/**
 * Entrada a una sesión de evento (ticket 5.8): el canje deja el `joinToken` en
 * el fragmento de la URL (`/play/session/<id>#joinToken=…`); aquí se recoge, se
 * quita de la barra de direcciones y se usa para unirse a la room `event`. El
 * nombre visible lo fija el token, así que no se pregunta.
 */
export function EventGame({
  model,
  pack,
  pack3d,
  sessionId,
  subtitle,
}: {
  model: PublicRuntimeModel;
  pack?: RoomScenePack;
  pack3d?: Pack3D;
  sessionId: string;
  subtitle?: string;
}) {
  const t = useTranslations("Game");
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const fromHash = readJoinTokenFromHash(window.location.hash);
    if (fromHash) {
      try {
        window.sessionStorage.setItem(tokenKey(sessionId), fromHash);
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
      setToken(window.sessionStorage.getItem(tokenKey(sessionId)));
    } catch {
      setToken(null);
    }
  }, [sessionId]);

  // F-36: objeto estable por `(sessionId, token)` — ver `room-game.tsx`.
  const target = useMemo(
    () => ({ kind: "event" as const, sessionId, joinToken: token ?? "" }),
    [sessionId, token],
  );

  if (token === undefined) {
    return <LoadingStatus message={t("status.connecting")} />;
  }
  if (!token) {
    return <AlertStatus message={t("event.missingToken")} />;
  }
  return (
    <NetworkGame model={model} pack={pack} pack3d={pack3d} target={target} subtitle={subtitle} />
  );
}
