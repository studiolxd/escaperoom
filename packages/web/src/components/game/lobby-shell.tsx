"use client";

import dynamic from "next/dynamic";
import { LobbyHud } from "./lobby-hud";

const LobbyCanvas = dynamic(() => import("./lobby-canvas"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
      Cargando lobby…
    </div>
  ),
});

/**
 * Contenedor del lobby multijugador: Phaser debajo (interpolando el estado
 * autoritativo de Colyseus) y overlay React encima.
 */
export function LobbyShell() {
  return (
    <section className="relative h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      <LobbyCanvas />
      <LobbyHud />
    </section>
  );
}
