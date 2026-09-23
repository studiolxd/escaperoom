"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  slidingNeighborIndices,
  type SlidingMoveOutcome,
  type SlidingPuzzlePublicView,
} from "@escaperoom/shared/templates";

/** Resultado del último movimiento, tal como lo devolvió el servidor. */
export type SlidingFeedback = SlidingMoveOutcome | null;

export interface SlidingPanelProps {
  /** Única fuente de verdad del panel: la proyección pública (sin la semilla). */
  view: SlidingPuzzlePublicView;
  /** Envía el índice de la ficha a deslizar al servidor; nunca se valida aquí. */
  onMove: (index: number) => void;
  /** URL base del pack gráfico (sin barra final), p. ej. `/packs/medieval-v1`. */
  baseUrl?: string;
  /** URL explícita de la imagen del mural; tiene prioridad sobre `baseUrl`. */
  imageUrl?: string;
  /** El host marca `true` mientras espera la respuesta del servidor. */
  pending?: boolean;
  /** Último resultado del servidor para pintar el feedback. */
  feedback?: SlidingFeedback;
  className?: string;
}

/** Rutas candidatas de la imagen del mural dentro del pack (SVG primero, PNG después). */
export function slidingImageUrls(imageAsset: string, baseUrl: string | undefined): string[] {
  if (!imageAsset || !baseUrl) return [];
  const base = baseUrl.replace(/\/$/, "");
  return [`${base}/images/${imageAsset}.svg`, `${base}/images/${imageAsset}.png`];
}

/**
 * Panel del `sliding_puzzle` (specs/06 §2.5). Es puramente presentacional: lee
 * `SlidingPuzzlePublicView` y delega cada deslizamiento en `onMove`. La mezcla,
 * la paridad y la detección de victoria viven en
 * `@escaperoom/shared/templates` (servidor). La imagen del mural se recorta por
 * CSS a partir del frame del pack; si no existe o falla, cae a un placeholder
 * con el número de ficha, así el puzle es jugable sin arte.
 */
export function SlidingPanel({
  view,
  onMove,
  baseUrl,
  imageUrl,
  pending = false,
  feedback = null,
  className,
}: SlidingPanelProps) {
  const t = useTranslations("SlidingPuzzle");
  const [imageStage, setImageStage] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const candidates = imageUrl ? [imageUrl] : slidingImageUrls(view.imageAsset, baseUrl);
  const imageSrc = candidates[imageStage];

  useEffect(() => {
    setImageStage(0);
  }, [imageUrl, view.imageAsset, baseUrl]);

  const movable = useMemo(
    () => new Set(slidingNeighborIndices(view.grid, view.blankIndex)),
    [view.grid, view.blankIndex],
  );

  const solved = view.state === "solved";
  const unavailable = view.state === "locked" || view.state === "failed";
  const disabled = solved || unavailable || pending;
  const { cols, rows } = view.grid;

  let status = t("prompt");
  if (solved) status = t("solved");
  else if (view.state === "locked") status = t("locked");
  else if (view.state === "failed") status = t("unavailable");
  else if (feedback === "already_solved") status = t("alreadySolved");
  else if (feedback === "unavailable") status = t("unavailable");
  else if (feedback === "not_adjacent") status = t("notAdjacent");

  function tryMove(index: number) {
    if (disabled || !movable.has(index)) return;
    onMove(index);
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
        <span className="text-xs text-white/60">{t("moves", { count: view.moveCount })}</span>
      </header>

      <div
        role="group"
        aria-label={t("boardLabel")}
        data-slot="sliding-board"
        className="grid-cols-dynamic grid w-fit gap-1 rounded-lg bg-black/40 p-1"
        style={{ "--cols": cols } as CSSProperties}
      >
        {view.tiles.map((tile, index) => {
          const isBlank = tile === 0;
          const canMove = !disabled && movable.has(index);
          const homeCol = isBlank ? 0 : (tile - 1) % cols;
          const homeRow = isBlank ? 0 : Math.floor((tile - 1) / cols);
          const backgroundPosition =
            cols > 1 && rows > 1
              ? `${(homeCol / (cols - 1)) * 100}% ${(homeRow / (rows - 1)) * 100}%`
              : "center";

          if (isBlank) {
            return (
              <div
                key={index}
                data-slot="sliding-blank"
                aria-label={t("blank")}
                onDragOver={(event) => {
                  if (disabled) return;
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = dragIndex ?? Number(event.dataTransfer.getData("text/plain"));
                  setDragIndex(null);
                  if (Number.isInteger(from)) tryMove(from);
                }}
                className="size-16 rounded-md border border-dashed border-white/15 bg-white/5"
              />
            );
          }

          return (
            <Button
              key={index}
              type="button"
              variant="overlayGhost"
              aria-label={t("tile", { tile })}
              data-tile={tile}
              data-movable={canMove}
              disabled={disabled || !canMove}
              draggable={canMove}
              onDragStart={(event) => {
                setDragIndex(index);
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragEnd={() => setDragIndex(null)}
              onClick={() => tryMove(index)}
              className={cn(
                "relative size-16 h-auto overflow-hidden rounded-md border p-0 text-sm font-semibold transition",
                canMove
                  ? "cursor-pointer border-amber-200/40 hover:border-amber-200/80"
                  : "cursor-default border-white/10",
              )}
              style={
                imageSrc
                  ? {
                      backgroundImage: `url(${imageSrc})`,
                      backgroundSize: `${cols * 100}% ${rows * 100}%`,
                      backgroundPosition,
                      backgroundRepeat: "no-repeat",
                    }
                  : undefined
              }
            >
              {!imageSrc ? (
                <span className="grid size-full place-items-center bg-amber-200/10 text-amber-100">
                  {tile}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>

      {imageSrc ? (
        <img
          src={imageSrc}
          alt=""
          aria-hidden
          className="hidden"
          onError={() => setImageStage((current) => current + 1)}
        />
      ) : null}

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
