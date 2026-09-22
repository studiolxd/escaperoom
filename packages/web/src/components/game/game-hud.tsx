"use client";

import { Flame, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TORCH_MAX, TORCH_MIN, useGameStore } from "@/store/game-store";

/**
 * Overlay React sobre el canvas de Phaser (specs/03 §3, ADR-019).
 *
 * El contenedor no captura el puntero (`pointer-events-none`) para que los
 * clics lleguen a Phaser; los elementos interactivos lo reactivan con
 * `pointer-events-auto`. Lee y escribe el mismo store Zustand que la escena.
 */
export function GameHud() {
  const torchLevel = useGameStore((state) => state.torchLevel);
  const tile = useGameStore((state) => state.tile);
  const addTorch = useGameStore((state) => state.addTorch);
  const reset = useGameStore((state) => state.reset);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <header className="pointer-events-auto flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-sm text-white backdrop-blur">
        <span className="font-medium">EscapeRoom</span>
        <span className="text-white/50">· tilemap isométrico de prueba</span>
      </header>

      <div className="pointer-events-auto flex w-fit flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-white backdrop-blur">
        <div className="flex items-center gap-2">
          <Flame
            className="size-5 text-amber-300"
            style={{ opacity: 0.25 + (torchLevel / TORCH_MAX) * 0.75 }}
          />
          <div className="leading-tight">
            <p className="text-xs text-white/60">Luz de la antorcha</p>
            <p className="font-mono text-sm tabular-nums">{torchLevel}%</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            aria-label="Bajar la luz"
            disabled={torchLevel <= TORCH_MIN}
            onClick={() => addTorch(-10)}
          >
            <Minus />
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={torchLevel >= TORCH_MAX}
            onClick={() => addTorch(10)}
          >
            <Plus data-icon="inline-start" />
            Encender
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw data-icon="inline-start" />
            Reset
          </Button>
        </div>

        <div className="border-l border-white/10 pl-3 text-xs text-white/60">
          Casilla{" "}
          <span className="font-mono text-white/90">
            ({tile.x}, {tile.y})
          </span>
        </div>
      </div>
    </div>
  );
}
