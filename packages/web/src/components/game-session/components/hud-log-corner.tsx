import type { HudLogEntry } from "../hooks/use-hud-log";

export interface HudLogCornerProps {
  log: readonly HudLogEntry[];
  title: string;
}

/**
 * Registro del playtest (F-5, "propio del playtest"): un único jugador local,
 * sin lista de jugadores ni invitación — misma posición y clases que ya tenía
 * `RoomPlaytestShell` antes de montar `GameSessionShell`.
 */
export function HudLogCorner({ log, title }: HudLogCornerProps) {
  return (
    <div className="pointer-events-none absolute right-4 top-4 w-52 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-white backdrop-blur">
      <span className="text-[0.65rem] uppercase tracking-wide text-white/50">{title}</span>
      <ul className="mt-1 flex flex-col gap-0.5 text-[0.65rem] text-white/70">
        {log.length === 0 ? <li className="text-white/40">—</li> : null}
        {log.map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ul>
    </div>
  );
}
