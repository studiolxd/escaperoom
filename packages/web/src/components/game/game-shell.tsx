"use client";

import dynamic from "next/dynamic";
import { GameHud } from "./game-hud";

const GameCanvas = dynamic(() => import("./game-canvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
      Cargando sala…
    </div>
  ),
});

/**
 * Contenedor del canvas híbrido: Phaser debajo, overlay React encima,
 * ambos sobre el mismo store Zustand (specs/03 §3).
 */
export function GameShell() {
  return (
    <section className="relative h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      <GameCanvas />
      <GameHud />
    </section>
  );
}
