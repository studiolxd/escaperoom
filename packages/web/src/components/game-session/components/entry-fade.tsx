import type { ReactNode } from "react";

export interface EntryFadeProps {
  children?: ReactNode;
}

/**
 * Fundido de fondo al pulsar «Empezar» (encargo limpieza-entrada): color
 * `--background` opaco del tema (no un blur translúcido sobre el lobby), con
 * la introducción (si la hay) encima. Se queda en pantalla hasta que el
 * servidor confirma `inMap` (`useLobbyFlow`, etapa `entering`) — entonces deja
 * de montarse y ya se ve el mapa real, sin cuenta atrás de por medio.
 */
export function EntryFade({ children }: EntryFadeProps) {
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 grid place-items-center overflow-y-auto bg-background p-4 text-foreground animate-in fade-in duration-1000"
      data-testid="game-entry-fade"
    >
      {children}
    </div>
  );
}
