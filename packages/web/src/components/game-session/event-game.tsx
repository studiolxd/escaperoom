"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { readJoinTokenFromHash } from "@/lib/game-net";
import { NetworkGame } from "./network-game";

/** El token se guarda por pestaña para reintentos y recargas (no en `localStorage`). */
const tokenKey = (sessionId: string) => `escaperoom:join-token:${sessionId}`;

/**
 * Entrada a una sesión de evento (ticket 5.8): el canje deja el `joinToken` en
 * el fragmento de la URL (`/play?session=<id>#joinToken=…`); aquí se recoge, se
 * quita de la barra de direcciones y se usa para unirse a la room `event`. El
 * nombre visible lo fija el token, así que no se pregunta.
 */
export function EventGame({
  model,
  pack,
  sessionId,
  subtitle,
}: {
  model: RuntimeModel;
  pack?: RoomScenePack;
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
    return <p className="p-4 text-sm text-white/70">{t("status.connecting")}</p>;
  }
  if (!token) {
    return (
      <p role="alert" className="p-4 text-sm text-white/70">
        {t("event.missingToken")}
      </p>
    );
  }
  return <NetworkGame model={model} pack={pack} target={target} subtitle={subtitle} />;
}
