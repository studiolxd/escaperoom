export interface CountdownOverlayProps {
  /** Segundos que quedan (3, 2, 1… 0 mientras el servidor confirma la entrada). */
  value: number;
  label: string;
}

/**
 * Cuenta atrás 3-2-1 antes de entrar al mapa (encargo lobby-diseño): 3 s y
 * sin botón de saltar — ni en la partida ni en el playtest. Solo presenta el
 * número; el temporizador vive en `useLobbyFlow`.
 */
export function CountdownOverlay({ value, label }: CountdownOverlayProps) {
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-slate-950/75 text-white backdrop-blur-sm"
      data-testid="game-countdown"
    >
      <div className="flex flex-col items-center gap-3" role="status" aria-live="assertive">
        <span className="text-8xl font-bold tabular-nums" data-testid="game-countdown-value">
          {value > 0 ? value : "…"}
        </span>
        <p className="text-sm text-white/70">{label}</p>
      </div>
    </div>
  );
}
