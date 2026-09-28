"use client";

import { useEffect, useState } from "react";
import { ItemIcon } from "@/components/puzzles/item-icon";

export interface ItemPickupPopProps {
  /** Fracción (0–1) de la posición del objeto que concedió el ítem. */
  x: number;
  y: number;
  frame?: string;
  baseUrl?: string;
  name: string;
}

/**
 * Ítem "apareciendo en el suelo" un instante al concederse (revisión en
 * vivo, items 4/5: la llave del cuadro, la vela y el yesquero del armario)
 * — antes se sumaban al inventario en silencio, sin ningún rastro en el
 * mundo. Sube y se desvanece sobre la posición del objeto que lo concedió;
 * `ItemPickupLayer` lo desmonta pasado el tiempo de la animación.
 */
export function ItemPickupPop({ x, y, frame, baseUrl, name }: ItemPickupPopProps) {
  const [risen, setRisen] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setRisen(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-full transition-all duration-1000 ease-out"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        opacity: risen ? 0 : 1,
        transform: `translate(-50%, ${risen ? "-140%" : "-100%"})`,
      }}
    >
      <div className="rounded-lg border border-amber-500/40 bg-card/90 p-1 shadow-lg dark:border-amber-200/40">
        <ItemIcon frame={frame} baseUrl={baseUrl} name={name} size={24} />
      </div>
    </div>
  );
}
