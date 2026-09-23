"use client";

import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { IsoRoomScene } from "./iso-room-scene";

/**
 * Monta Phaser 3 dentro de un contenedor React (`useRef`) y lo destruye al
 * desmontar. Solo se carga en cliente vía `next/dynamic` con `ssr: false`
 * (ver `game-shell.tsx`), porque Phaser necesita `window`/`canvas`.
 */
export default function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || gameRef.current) {
      return;
    }

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
      // El fondo isométrico no reproduce sonido: sin `noAudio`, Phaser crea de
      // todos modos un `AudioContext` y sus listeners de visibilidad, que
      // disparaban `InvalidStateError: Cannot suspend/resume a closed
      // AudioContext` tras `game.destroy()` (p. ej. con StrictMode en dev).
      audio: { noAudio: true },
      scene: [IsoRoomScene],
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" aria-hidden />;
}
