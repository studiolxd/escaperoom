"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createNetworkGameClient,
  createReadOnlyGameClient,
  type NetworkGameClient,
} from "@escaperoom/game-runtime/session";
import { COLYSEUS_URL } from "@/lib/colyseus";
import {
  Client,
  isConsentedClose,
  isExpiredClose,
  joinGameRoom,
  type GameJoinTarget,
  type GameRoomHandle,
} from "@/lib/game-net";
import {
  clearGameReconnect,
  createSeatKey,
  readGameReconnect,
  writeGameReconnect,
} from "@/lib/game-reconnect";
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
  /**
   * Salida EXPLÍCITA y consentida (C-2, ajuste 2026-09-25): solo esto debe
   * liberar la plaza durante la partida. Navegar dentro de la app, recargar
   * o cerrar la pestaña NO llama a esto — el `useEffect` los trata como una
   * caída de red (`leave(false)`), que conserva la plaza hasta el fin de la
   * partida (specs/11 §8.1).
   */
  leaveGame: () => void;
}

export interface UseGameConnectionOptions {
  target: GameJoinTarget;
  name?: string;
  /** Personaje elegido en la pantalla de unión (A1); el servidor lo valida. */
  characterId?: string;
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
  characterId,
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
  /** Room activa; la usa `leaveGame` (salida explícita, fuera del efecto). */
  const roomRef = useRef<GameRoomHandle | null>(null);

  // F-36: `target` lleva el token de acceso (`gameToken`/`joinToken`); sin
  // memoizar, `JSON.stringify` se repetía en cada render (también los que no
  // tocan la conexión, p. ej. el HUD reflejando el estado de la partida).
  const targetKey = useMemo(() => JSON.stringify(target), [target]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let room: GameRoomHandle | null = null;
    let networkClient: NetworkGameClient | null = null;
    const parsedTarget = JSON.parse(targetKey) as GameJoinTarget;
    // C-2 (ajuste 2026-09-25): `roomId` ya conocido (link de invitación, o una
    // room propia creada antes en esta misma carga) es la clave de la
    // reconexión persistida — la `GameRoom` desnuda no tiene `playerId`
    // estable como `EventRoom`, así que sin esto recargar o cerrar y reabrir
    // la pestaña entraba siempre como jugador nuevo.
    const knownRoomId =
      parsedTarget.kind === "game" ? parsedTarget.roomId ?? joinedRoomRef.current : undefined;
    const stored = knownRoomId ? readGameReconnect(knownRoomId) : null;
    const seatKey = parsedTarget.kind === "game" ? stored?.seatKey ?? createSeatKey() : undefined;
    const joinTarget: GameJoinTarget =
      parsedTarget.kind === "game" && joinedRoomRef.current
        ? { kind: "game", roomId: joinedRoomRef.current, gameToken: parsedTarget.gameToken }
        : parsedTarget;

    setStatus("connecting");
    setError(null);
    useMediaStore.getState().reset();

    const colyseusClient = new Client(url);

    const persistReconnect = (joined: GameRoomHandle) => {
      if (parsedTarget.kind === "game" && seatKey) {
        writeGameReconnect(joined.roomId, { seatKey, reconnectionToken: joined.reconnectionToken });
      }
    };

    const afterJoined = (joined: GameRoomHandle) => {
      if (disposed) {
        void joined.leave(false);
        return;
      }
      room = joined;
      roomRef.current = joined;
      joined.reconnection.maxRetries = AUTO_RECONNECT_RETRIES;
      joinedRoomRef.current = joined.roomId;
      persistReconnect(joined);
      networkClient = createNetworkGameClient(joined);
      // Observador (5.9): cliente de solo lectura y sin voz/webcam.
      const spectating = parsedTarget.kind === "spectate";
      networkClient.onEvent((event) => {
        if (event.type === "media_token" && !disposed) {
          useMediaStore.getState().setPayload(parseMediaTokenPayload(event.payload));
        }
      });
      if (!spectating) networkClient.requestMediaToken(role);
      joined.onDrop(() => {
        if (!disposed) setStatus("reconnecting");
      });
      joined.onReconnect(() => {
        if (!disposed) {
          setStatus("connected");
          persistReconnect(joined); // el SDK renueva el token en cada reconexión.
        }
      });
      joined.onLeave((code) => {
        if (disposed) return;
        useMediaStore.getState().reset();
        setStatus(isExpiredClose(code) ? "expired" : "disconnected");
        if (!isConsentedClose(code) && !isExpiredClose(code)) setError(`close ${code}`);
        // Salida definitiva (consentida o gracia agotada/fin de partida): ya
        // no hay nada que reconectar con esta room.
        clearGameReconnect(joined.roomId);
      });
      setRoomId(joined.roomId);
      setClient(spectating ? createReadOnlyGameClient(networkClient) : networkClient);
      setStatus("connected");
      onJoinedRef.current?.(joined.roomId);
    };

    /** Token de reconexión nativo de Colyseus (recupera la MISMA `sessionId`). */
    const tryNativeReconnect = async (): Promise<GameRoomHandle | null> => {
      if (!stored?.reconnectionToken) return null;
      try {
        return (await colyseusClient.reconnect(stored.reconnectionToken)) as GameRoomHandle;
      } catch {
        // Caducado, rechazado o de otra room: el `seatKey` es el respaldo.
        if (knownRoomId) clearGameReconnect(knownRoomId);
        return null;
      }
    };

    void (async () => {
      try {
        const reconnected = await tryNativeReconnect();
        const sendTarget: GameJoinTarget =
          joinTarget.kind === "game" && seatKey ? { ...joinTarget, seatKey } : joinTarget;
        const joined =
          reconnected ?? (await joinGameRoom(colyseusClient, sendTarget, name, characterId));
        afterJoined(joined);
      } catch (reason: unknown) {
        if (disposed) return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();

    return () => {
      disposed = true;
      networkClient?.dispose();
      // C-2 (ajuste 2026-09-25): NO consentida. Desmontar este efecto —
      // navegar dentro de la app, o el `useEffect` reejecutándose por un
      // cambio de opciones— no es un "salir de la partida" explícito; debe
      // tratarse como una caída de red (conserva la plaza hasta el fin de la
      // partida), no como un abandono que libera la plaza al instante.
      void room?.leave(false);
      roomRef.current = null;
      setClient(null);
      useMediaStore.getState().reset();
    };
  }, [enabled, targetKey, name, characterId, role, url, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const leaveGame = useCallback(() => {
    const room = roomRef.current;
    if (room) clearGameReconnect(room.roomId);
    void room?.leave(true);
  }, []);

  return { status, client, roomId, error, retry, leaveGame };
}
