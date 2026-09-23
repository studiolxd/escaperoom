"use client";

import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { Client, type Room } from "@colyseus/sdk";
import { CHAT_MESSAGE, CHAT_RATE_LIMITED_ERROR } from "@escaperoom/shared/chat";
import { COLYSEUS_URL, LOBBY_ROOM_NAME } from "@/lib/colyseus";
import {
  MEDIA_TOKEN_MESSAGE,
  MEDIA_TOKEN_REQUEST_MESSAGE,
  parseMediaTokenPayload,
  type MediaRole,
} from "@/lib/media";
import { collectChat, collectPlayers, type LobbyStateLike } from "@/lib/lobby-net";
import { useLobbyStore } from "@/store/lobby-store";
import { useMediaStore } from "@/store/media-store";
import { LobbyTestScene } from "./lobby-scene";

/**
 * Monta Phaser con `LobbyTestScene` y abre la conexión Colyseus a `lobby_test`.
 * El estado que llega del servidor (autoritativo) se vuelca al store Zustand,
 * que la escena y el HUD leen; los envíos de movimiento salen por el registro
 * del juego (`sendMove`). Solo se carga en cliente (`ssr: false`).
 */
export default function LobbyCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || gameRef.current) {
      return;
    }

    const store = useLobbyStore.getState();
    store.setStatus("connecting");
    store.setError(null);
    store.setConnectionError(null);
    useMediaStore.getState().reset();

    // El rol se elige por query param (`?role=observer`) para poder probar el
    // modo solo-suscripción del organizador sin infraestructura de eventos.
    const requestedRole: MediaRole =
      new URLSearchParams(window.location.search).get("role") === "observer"
        ? "observer"
        : "player";

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      backgroundColor: "#0b1120",
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: "100%",
        height: "100%",
      },
      render: { antialias: true, pixelArt: false },
      scene: [LobbyTestScene],
    });
    gameRef.current = game;

    let disposed = false;
    let room: Room<LobbyStateLike> | null = null;
    const client = new Client(COLYSEUS_URL);

    client
      .joinOrCreate<LobbyStateLike>(LOBBY_ROOM_NAME, { role: requestedRole })
      .then((joined) => {
        if (disposed) {
          void joined.leave();
          return;
        }
        room = joined;
        game.registry.set("sendMove", (x: number, y: number) => {
          joined.send("move", { x, y });
        });

        const sync = (state: LobbyStateLike) => {
          if (!disposed) {
            const store = useLobbyStore.getState();
            store.setPlayers(collectPlayers(state));
            store.setChat(collectChat(state));
          }
        };

        store.setStatus("connected");
        store.setSelfId(joined.sessionId);
        store.setSendChat((text) => {
          useLobbyStore.getState().setChatError(null);
          joined.send(CHAT_MESSAGE, { text });
        });
        joined.onStateChange((state) => sync(state));
        sync(joined.state);
        joined.onMessage<{ code?: string; message?: string }>("error", (message) => {
          if (disposed) {
            return;
          }
          const code = message.code ?? "error";
          const store = useLobbyStore.getState();
          if (code === CHAT_RATE_LIMITED_ERROR) {
            store.setChatError(message.message ?? code);
          } else {
            store.setError(code);
          }
        });
        // Medios (specs/11 §8): pedimos el token al servidor en el join y
        // escuchamos `media_token`. Sin claves LiveKit llega
        // `configured: false` y el overlay queda en "sin medios".
        joined.onMessage(MEDIA_TOKEN_MESSAGE, (payload: unknown) => {
          if (!disposed) {
            useMediaStore.getState().setPayload(parseMediaTokenPayload(payload));
          }
        });
        joined.send(MEDIA_TOKEN_REQUEST_MESSAGE, { role: requestedRole });
        joined.onLeave(() => {
          if (!disposed) {
            useLobbyStore.getState().setStatus("disconnected");
            useMediaStore.getState().reset();
          }
        });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        const current = useLobbyStore.getState();
        current.setStatus("error");
        current.setConnectionError(error instanceof Error ? error.message : String(error));
        useMediaStore.getState().reset();
      });

    return () => {
      disposed = true;
      room?.leave();
      room = null;
      game.registry.remove("sendMove");
      game.destroy(true);
      gameRef.current = null;
      useLobbyStore.getState().reset();
      useMediaStore.getState().reset();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />;
}
