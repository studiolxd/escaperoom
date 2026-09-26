import { useCallback, useRef, useState } from "react";

export interface HudLogEntry {
  id: number;
  text: string;
}

/** Registro acotado del HUD (últimas `maxEntries`), compartido por partida y playtest. */
export function useHudLog(maxEntries = 12) {
  const idRef = useRef(0);
  const [log, setLog] = useState<HudLogEntry[]>([]);
  const pushLog = useCallback(
    (text: string) => {
      idRef.current += 1;
      const entry = { id: idRef.current, text };
      setLog((prev) => [entry, ...prev].slice(0, maxEntries));
    },
    [maxEntries],
  );
  return { log, pushLog };
}
