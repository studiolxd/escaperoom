"use client";

import { useCallback } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { GameJoinTarget } from "@/lib/game-net";
import { NetworkGame } from "./network-game";

/**
 * Envoltorio de `NetworkGame` para `(play)/dev/game-room` (E2E de reconexión,
 * DEUDA): refleja el id de la `GameRoom` creada en `?room=` de la URL, para
 * que recargar la página o cerrar y reabrir la pestaña vuelva a la MISMA
 * partida (`game-reconnect.ts` la busca por ese id). Sin esto en un
 * componente cliente aparte, `network-game.tsx` tendría que tocar
 * `window.history` por sí solo para un caso que solo usa esta página.
 */
export function NetworkGameDev({
  model,
  pack,
  target,
  subtitle,
}: {
  model: RuntimeModel;
  pack?: RoomScenePack;
  target: GameJoinTarget;
  subtitle?: string;
}) {
  const onJoined = useCallback((roomId: string) => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("room") === roomId) return;
    url.searchParams.set("room", roomId);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  return <NetworkGame model={model} pack={pack} target={target} subtitle={subtitle} onJoined={onJoined} />;
}
