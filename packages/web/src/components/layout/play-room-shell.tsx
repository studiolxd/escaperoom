"use client";

import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { PlayPhaseContext } from "@/components/game-session/play-phase-context";

/**
 * Chrome de `/play/room/[roomId]`: header y footer públicos (recibidos como
 * elementos ya resueltos en servidor) mientras se elige nombre o se conecta,
 * y sin ellos (ni el padding de `main`) en cuanto la partida arranca de
 * verdad — `NetworkGame` avisa del cambio de fase vía `PlayPhaseContext`.
 */
export function PlayRoomShell({
  header,
  footer,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      {playing ? null : header}
      <div className="flex min-h-0 flex-1 flex-col">
        <main className={cn("relative min-h-0 w-full flex-1 overflow-hidden", !playing && "p-4")}>
          <PlayPhaseContext.Provider value={setPlaying}>{children}</PlayPhaseContext.Provider>
        </main>
      </div>
      {playing ? null : footer}
    </div>
  );
}
