"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  applyTemplatePreview,
  createTemplatePreview,
  isTemplatePreviewSolved,
  type TemplatePreview,
  type TemplatePreviewAction,
} from "@escaperoom/editor/template-config";
import type { PuzzleDefinition } from "@escaperoom/shared/schemas";
import {
  toCombineItemsPublicView,
  toHiddenKeyPublicView,
  toMemoryPublicView,
  toPipesPuzzlePublicView,
  toCodeLockPublicView,
  toSimultaneousPlatesPublicView,
  toSlidingPuzzlePublicView,
  toSplitCluePublicView,
} from "@escaperoom/shared/templates";
import { Button } from "@/components/ui/button";
import { CodeLockPanel } from "@/components/puzzles/code-lock-panel";
import { HiddenKeyPanel } from "@/components/puzzles/hidden-key-panel";
import { InventoryPanel, type InventoryItemView } from "@/components/puzzles/inventory-panel";
import { MemoryPanel } from "@/components/puzzles/memory-panel";
import { PipesPanel } from "@/components/puzzles/pipes-panel";
import { PlatesPanel } from "@/components/puzzles/plates-panel";
import { SlidingPanel } from "@/components/puzzles/sliding-panel";
import { SplitCluePanel } from "@/components/puzzles/split-clue-panel";

export interface TemplatePreviewPanelProps {
  preview: TemplatePreview;
  onAction: (action: TemplatePreviewAction) => void;
  /** Reloj de la vista previa (placas: ventana temporal). */
  now: number;
  /** URL base del pack (imagen del deslizante), como en juego. */
  baseUrl?: string;
  /** Catálogo de ítems (id → nombre/icono) para el inventario de `combine_items`. */
  items?: InventoryItemView[];
  renderIcon?: (item: InventoryItemView) => ReactNode;
}

/**
 * Panel de juego de la plantilla sobre el estado local de la vista previa. Son
 * **los mismos componentes que en juego** (`CodeLockPanel`, `MemoryPanel`…)
 * con las mismas props: la proyección pública de la plantilla y los callbacks
 * de intención, que aquí resuelve `applyTemplatePreview` en vez del servidor.
 */
export function TemplatePreviewPanel({
  preview,
  onAction,
  now,
  baseUrl,
  items = [],
  renderIcon,
}: TemplatePreviewPanelProps) {
  switch (preview.type) {
    case "hidden_key":
      return (
        <HiddenKeyPanel
          view={toHiddenKeyPublicView(preview.state, preview.def)}
          onReveal={() => onAction({ type: "reveal" })}
          feedback={preview.feedback}
        />
      );
    case "code_lock":
      return (
        <CodeLockPanel
          view={toCodeLockPublicView(preview.state, preview.def)}
          onAttempt={(code) => onAction({ type: "attempt_code", code })}
          feedback={preview.feedback}
        />
      );
    case "simultaneous_plates":
      return (
        <PlatesPanel
          view={toSimultaneousPlatesPublicView(preview.state, preview.def, now)}
          onTogglePlate={(objectId, active) => onAction({ type: "toggle_plate", objectId, active })}
          onPlaceBridge={() => onAction({ type: "place_plates_bridge" })}
          feedback={preview.feedback}
        />
      );
    case "combine_items":
      return (
        <InventoryPanel
          view={toCombineItemsPublicView(preview.state, preview.def)}
          items={items}
          onCombine={(inputs) => onAction({ type: "combine", inputs })}
          feedback={preview.feedback}
          renderIcon={renderIcon}
        />
      );
    case "sliding_puzzle":
      return (
        <SlidingPanel
          view={toSlidingPuzzlePublicView(preview.state, preview.def)}
          onMove={(index) => onAction({ type: "slide", index })}
          baseUrl={baseUrl}
          feedback={preview.feedback}
        />
      );
    case "memory":
      return (
        <MemoryPanel
          view={toMemoryPublicView(preview.state, preview.def)}
          onFlip={(cardId) => onAction({ type: "flip", cardId })}
          feedback={preview.feedback}
        />
      );
    case "split_clue":
      return (
        <SplitCluePanel
          view={toSplitCluePublicView(preview.state, preview.def, preview.viewpointId)}
          onSubmit={(combination) => onAction({ type: "submit_clue", combination })}
          onPlaceBridge={() => onAction({ type: "place_clue_bridge" })}
          feedback={preview.feedback}
        />
      );
    case "pipes":
      return (
        <PipesPanel
          view={toPipesPuzzlePublicView(preview.state, preview.def)}
          onRotate={(index) => onAction({ type: "rotate_pipe", index })}
          onOpenGate={(index) => onAction({ type: "open_gate", index })}
          feedback={preview.feedback}
        />
      );
  }
}

export interface PuzzlePreviewProps {
  /** Puzzle tal como está en el doc (se reinicia la vista previa si cambia). */
  puzzle: PuzzleDefinition;
  baseUrl?: string;
  items?: InventoryItemView[];
  renderIcon?: (item: InventoryItemView) => ReactNode;
}

/**
 * Vista previa jugable del puzzle configurado (specs/09 §1): el creador lo
 * resuelve en el editor sin servidor. Cada cambio de la configuración reinicia
 * la partida (el `key` del host es la definición serializada).
 */
export function PuzzlePreview({ puzzle, baseUrl, items, renderIcon }: PuzzlePreviewProps) {
  const t = useTranslations("TemplateConfig");
  const [preview, setPreview] = useState(() => createTemplatePreview(puzzle));
  const [now, setNow] = useState(() => Date.now());
  const solved = isTemplatePreviewSolved(preview);

  // Las placas dependen del reloj (ventana temporal): se refresca mientras se juega.
  const ticking = preview.type === "simultaneous_plates" && !solved;
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [ticking]);

  const act = (action: TemplatePreviewAction) => {
    const at = Date.now();
    setNow(at);
    setPreview((current) => applyTemplatePreview(current, action, at));
  };

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="template-preview"
      data-template-preview={preview.type}
      data-solved={solved}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-white/60">{t("preview.title")}</span>
        {solved ? (
          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">
            {t("preview.solved")}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 border border-white/15 px-2 text-xs text-white hover:bg-white/10"
          onClick={() => {
            setNow(Date.now());
            setPreview(createTemplatePreview(puzzle));
          }}
        >
          {t("preview.reset")}
        </Button>
      </div>
      {preview.type === "split_clue" && preview.def.viewpoints.length > 1 ? (
        <div
          role="group"
          aria-label={t("preview.viewpoint")}
          className="flex flex-wrap items-center gap-1"
        >
          <span className="text-xs text-white/60">{t("preview.viewpoint")}</span>
          {preview.def.viewpoints.map((viewpoint) => (
            <Button
              key={viewpoint.objectId}
              size="sm"
              variant="ghost"
              aria-pressed={viewpoint.objectId === preview.viewpointId}
              className="h-6 border border-white/15 px-2 font-mono text-xs text-white hover:bg-white/10 aria-pressed:bg-white/15"
              onClick={() => act({ type: "select_viewpoint", viewpointId: viewpoint.objectId })}
            >
              {viewpoint.objectId}
            </Button>
          ))}
        </div>
      ) : null}
      <TemplatePreviewPanel
        preview={preview}
        onAction={act}
        now={now}
        baseUrl={baseUrl}
        items={items}
        renderIcon={renderIcon}
      />
    </div>
  );
}
