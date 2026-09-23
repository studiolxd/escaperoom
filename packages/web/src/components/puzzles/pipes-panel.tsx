"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import {
  PIPE_EAST,
  PIPE_NORTH,
  PIPE_SOUTH,
  PIPE_WEST,
  pipeOpenings,
  type PipesCellPublicView,
  type PipesGateOutcome,
  type PipesPuzzlePublicView,
  type PipesRotateOutcome,
} from "@escaperoom/shared/templates";

/** Resultado de la última acción, tal como lo devolvió el servidor. */
export type PipesFeedback = PipesRotateOutcome | PipesGateOutcome | null;

export interface PipesPanelProps {
  /** Única fuente de verdad del panel: la proyección pública (sin la solución). */
  view: PipesPuzzlePublicView;
  /** Envía al servidor el índice de la pieza a girar (90° horario); nunca se valida aquí. */
  onRotate: (index: number) => void;
  /** Presenta el objeto del jugador en la compuerta de `index` (el servidor decide). */
  onOpenGate?: (index: number) => void;
  /** El host marca `true` mientras espera la respuesta del servidor. */
  pending?: boolean;
  /** Último resultado del servidor para pintar el feedback. */
  feedback?: PipesFeedback;
  className?: string;
}

/** Milisegundos entre una celda mojada y la siguiente (efecto de avance del agua). */
export const PIPES_FLOW_STEP_MS = 90;

const ARMS: [number, string][] = [
  [PIPE_NORTH, "M32 32 V0"],
  [PIPE_EAST, "M32 32 H64"],
  [PIPE_SOUTH, "M32 32 V64"],
  [PIPE_WEST, "M32 32 H0"],
];

/**
 * Panel del `pipes` (specs/06 §2.8). Es puramente presentacional: lee
 * `PipesPuzzlePublicView`, delega cada giro en `onRotate` y cada uso de objeto
 * en una compuerta en `onOpenGate`. El flood fill, las compuertas y la
 * detección de victoria viven en `@escaperoom/shared/templates` (servidor).
 *
 * El agua se anima a partir de `view.flow`: cada celda mojada se tiñe con un
 * retardo proporcional a su distancia al origen, así el caudal "avanza" por el
 * canal cada vez que una rotación conecta un tramo nuevo.
 */
export function PipesPanel({
  view,
  onRotate,
  onOpenGate,
  pending = false,
  feedback = null,
  className,
}: PipesPanelProps) {
  const t = useTranslations("Pipes");

  const wetDepth = useMemo(
    () => new Map(view.flow.map((cell) => [cell.index, cell.depth])),
    [view.flow],
  );

  const solved = view.state === "solved";
  const unavailable = view.state === "locked" || view.state === "failed";
  const disabled = solved || unavailable || pending;
  const startIndex = view.startCell.y * view.grid.cols + view.startCell.x;
  const endIndex = view.endCell.y * view.grid.cols + view.endCell.x;

  let status = t("prompt");
  if (solved) status = t("solved");
  else if (view.state === "locked") status = t("locked");
  else if (view.state === "failed") status = t("unavailable");
  else if (feedback === "already_solved") status = t("alreadySolved");
  else if (feedback === "unavailable") status = t("unavailable");
  else if (feedback === "not_rotatable" || feedback === "invalid_rotation") {
    status = t("notRotatable");
  } else if (feedback === "missing_item") status = t("missingItem");
  else if (feedback === "opened") status = t("gateOpened");
  else if (feedback === "already_open") status = t("alreadyOpen");
  else if (feedback === "not_a_gate") status = t("notAGate");

  function cellLabel(cell: PipesCellPublicView): string {
    const base = t("cell", { x: cell.x + 1, y: cell.y + 1 });
    const parts = [base];
    if (cell.index === startIndex) parts.push(t("start"));
    if (cell.index === endIndex) parts.push(t("end"));
    if (cell.gate === "closed") parts.push(t("gateClosed"));
    else if (cell.gate === "open") parts.push(t("gateOpen"));
    else if (cell.gate === "wall") parts.push(t("wall"));
    else if (cell.kind === "empty") parts.push(t("rock"));
    return parts.join(" · ");
  }

  return (
    <section
      aria-label={t("title")}
      data-state={view.state}
      className={cn(
        "flex w-fit flex-col gap-4 rounded-xl border border-white/10 bg-black/60 p-4 text-white backdrop-blur",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <span className="text-xs text-white/60">
          {t("rotations", { count: view.rotationCount })}
        </span>
      </header>

      <div
        role="group"
        aria-label={t("boardLabel")}
        data-slot="pipes-board"
        data-connected={view.connected}
        className="grid w-fit gap-1 rounded-lg bg-black/40 p-1"
        style={{ gridTemplateColumns: `repeat(${view.grid.cols}, minmax(0, 1fr))` }}
      >
        {view.cells.map((cell) => {
          const depth = wetDepth.get(cell.index);
          const wet = depth !== undefined;
          const isGate = cell.gate === "closed" || cell.gate === "open";
          const canRotate = !disabled && cell.rotatable;
          const canOpen = !disabled && cell.gate === "closed" && onOpenGate !== undefined;
          const interactive = canRotate || canOpen;

          return (
            <button
              key={cell.index}
              type="button"
              aria-label={canOpen ? `${cellLabel(cell)} — ${t("useItem")}` : cellLabel(cell)}
              data-cell={cell.index}
              data-kind={cell.kind}
              data-gate={cell.gate ?? undefined}
              data-wet={wet}
              disabled={!interactive}
              onClick={() => {
                if (canRotate) onRotate(cell.index);
                else if (canOpen) onOpenGate?.(cell.index);
              }}
              className={cn(
                "relative size-14 overflow-hidden rounded-md border transition",
                cell.index === startIndex || cell.index === endIndex
                  ? "border-sky-300/50"
                  : "border-white/10",
                interactive ? "cursor-pointer hover:border-amber-200/70" : "cursor-default",
                cell.kind === "empty" && !isGate ? "bg-stone-800/70" : "bg-stone-900/60",
              )}
            >
              <PipeGlyph cell={cell} wet={wet} delayMs={(depth ?? 0) * PIPES_FLOW_STEP_MS} />
              {cell.index === startIndex || cell.index === endIndex ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute right-1 top-1 size-2 rounded-full",
                    cell.index === endIndex && solved
                      ? "animate-pulse bg-sky-300"
                      : "bg-sky-300/60",
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <p
        aria-live="polite"
        data-tone={solved ? "success" : unavailable ? "locked" : "info"}
        className={cn(
          "text-center text-xs",
          solved ? "text-emerald-300" : unavailable ? "text-amber-300" : "text-white/60",
        )}
      >
        {pending ? t("pending") : status}
      </p>
    </section>
  );
}

/**
 * Dibujo de una celda. Las piezas giratorias se pintan con su forma base y se
 * rotan por CSS (transición suave al girar); las compuertas se pintan con sus
 * aberturas efectivas (cerrada: barrote dorado; abierta: cruce).
 */
function PipeGlyph({
  cell,
  wet,
  delayMs,
}: {
  cell: PipesCellPublicView;
  wet: boolean;
  delayMs: number;
}) {
  if (cell.gate === "wall" || (cell.kind === "empty" && cell.gate === null)) {
    return (
      <svg viewBox="0 0 64 64" aria-hidden className="size-full">
        <rect x="14" y="14" width="36" height="36" rx="8" className="fill-stone-600/60" />
      </svg>
    );
  }

  const isGate = cell.gate !== null;
  const openings = isGate ? cell.openings : pipeOpenings(cell.kind, 0);
  const transform = isGate ? undefined : `rotate(${cell.rotation * 90}deg)`;
  const waterStyle = {
    transitionProperty: "stroke, opacity",
    transitionDuration: "240ms",
    transitionDelay: wet ? `${delayMs}ms` : "0ms",
  };

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      className="size-full transition-transform duration-200"
      style={{ transform }}
    >
      {ARMS.filter(([bit]) => (openings & bit) !== 0).map(([bit, d]) => (
        <path
          key={`pipe-${bit}`}
          d={d}
          strokeWidth={16}
          strokeLinecap="butt"
          className="stroke-stone-500"
        />
      ))}
      {ARMS.filter(([bit]) => (openings & bit) !== 0).map(([bit, d]) => (
        <path
          key={`water-${bit}`}
          d={d}
          strokeWidth={7}
          strokeLinecap="round"
          className={wet ? "stroke-sky-400" : "stroke-stone-800"}
          style={waterStyle}
        />
      ))}
      {openings !== 0 ? (
        <circle
          cx="32"
          cy="32"
          r="9"
          className={wet ? "fill-sky-400" : "fill-stone-700"}
          style={{ ...waterStyle, transitionProperty: "fill" }}
        />
      ) : null}
      {cell.gate === "closed" ? (
        <g>
          <rect x="10" y="26" width="44" height="12" rx="3" className="fill-amber-400/90" />
          <circle cx="32" cy="32" r="3" className="fill-stone-900" />
        </g>
      ) : null}
    </svg>
  );
}
