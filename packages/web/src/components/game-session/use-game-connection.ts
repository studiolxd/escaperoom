"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createNetworkGameClient, type NetworkGameClient } from "@escaperoom/game-runtime/session";
import { COLYSEUS_URL } from "@/lib/colyseus";
import {
  Client,
  isConsentedClose,
  isExpiredClose,
  joinGameRoom,
  type GameJoinTarget,
  type GameRoomHandle,
} from "@/lib/game-net";
import { parseMediaTokenPayload, type MediaRole } from "@/lib/media";
import { useMediaStore } from "@/store/media-store";

export type GameConnectionStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "expired" | "error";

export interface GameConnection {
  status: GameConnectionStatus;
  client: NetworkGameClient | null;
  /** Id de la room de Colyseus a la que se unió (para el link de invitación). */
  roomId: string | null;
  error: string | null;
  /** Vuelve a unirse (a la misma room si ya se había entrado en una). */
  retry: () => void;
}

export interface UseGameConnectionOptions {
  target: GameJoinTarget;
  name?: string;
  /** `false` mientras el jugador aún no ha pulsado «Entrar». */
  enabled?: boolean;
  role?: MediaRole;
  url?: string;
  /** Tras unirse (p. ej. para fijar `?room=` en la URL). */
  onJoined?: (roomId: string) => void;
}

/**
 * Reintentos automáticos del SDK tras una caída. El servidor aún no reserva el
 * asiento al caer (reconexión con gracia, fase 6), así que se desiste pronto y
 * se ofrece el reintento manual, que vuelve a entrar en la misma room.
 */
const AUTO_RECONNECT_RETRIES = 3;

/**
 * Conexión de la página de partida con la `GameRoom`/`PlaytestRoom`: estado
 * (conectando, conectado, reconectando, desconectado, caducado, error), el
 * `GameClient` de red para la UI y reintento. También pide el token de medios
 * al entrar y lo deja en el store que lee el overlay de LiveKit (ticket 2.2).
 */
export function useGameConnection({
  target,
  name,
  enabled = true,
  role = "player",
  url = COLYSEUS_URL,
  onJoined,
}: UseGameConnectionOptions): GameConnection {
  const [status, setStatus] = useState<GameConnectionStatus>("idle");
  const [client, setClient] = useState<NetworkGameClient | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Room ya creada/unida: el reintento vuelve a ella en vez de crear otra. */
  const joinedRoomRef = useRef<string | null>(null);
  const onJoinedRef = useRef(onJoined);
  onJoinedRef.current = onJoined;

  const targetKey = JSON.stringify(target);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let room: GameRoomHandle | null = null;
    let networkClient: NetworkGameClient | null = null;
    const parsedTarget = JSON.parse(targetKey) as GameJoinTarget;
    const joinTarget: GameJoinTarget =
      parsedTarget.kind === "game" && joinedRoomRef.current
        ? { kind: "game", roomId: joinedRoomRef.current }
        : parsedTarget;

    setStatus("connecting");
    setError(null);
    useMediaStore.getState().reset();

    joinGameRoom(new Client(url), joinTarget, name)
      .then((joined) => {
        if (disposed) {
          void joined.leave();
          return;
        }
        room = joined;
        joined.reconnection.maxRetries = AUTO_RECONNECT_RETRIES;
        joinedRoomRef.current = joined.roomId;
        networkClient = createNetworkGameClient(joined);
        networkClient.onEvent((event) => {
          if (event.type === "media_token" && !disposed) {
            useMediaStore.getState().setPayload(parseMediaTokenPayload(event.payload));
          }
        });
        networkClient.requestMediaToken(role);
        joined.onDrop(() => {
          if (!disposed) setStatus("reconnecting");
        });
        joined.onReconnect(() => {
          if (!disposed) setStatus("connected");
        });
        joined.onLeave((code) => {
          if (disposed) return;
          useMediaStore.getState().reset();
          setStatus(isExpiredClose(code) ? "expired" : "disconnected");
          if (!isConsentedClose(code) && !isExpiredClose(code)) setError(`close ${code}`);
        });
        setRoomId(joined.roomId);
        setClient(networkClient);
        setStatus("connected");
        onJoinedRef.current?.(joined.roomId);
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      disposed = true;
      networkClient?.dispose();
      void room?.leave(true);
      setClient(null);
      useMediaStore.getState().reset();
    };
  }, [enabled, targetKey, name, role, url, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { status, client, roomId, error, retry };
}
