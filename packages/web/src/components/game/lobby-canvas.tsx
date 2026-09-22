"use client";

import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { Client, type Room } from "@colyseus/sdk";
import { COLYSEUS_URL, LOBBY_ROOM_NAME } from "@/lib/colyseus";
import { collectPlayers, type LobbyStateLike } from "@/lib/lobby-net";
import { useLobbyStore } from "@/store/lobby-store";
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
      .joinOrCreate<LobbyStateLike>(LOBBY_ROOM_NAME)
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
            useLobbyStore.getState().setPlayers(collectPlayers(state));
          }
        };

        store.setStatus("connected");
        store.setSelfId(joined.sessionId);
        joined.onStateChange((state) => sync(state));
        sync(joined.state);
        joined.onMessage<{ code?: string }>("error", (message) => {
          if (!disposed) {
            useLobbyStore.getState().setError(message.code ?? "error");
          }
        });
        joined.onLeave(() => {
          if (!disposed) {
            useLobbyStore.getState().setStatus("disconnected");
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
      });

    return () => {
      disposed = true;
      room?.leave();
      room = null;
      game.registry.remove("sendMove");
      game.destroy(true);
      gameRef.current = null;
      useLobbyStore.getState().reset();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />;
}
