"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import type { CombinationOutcome, CombineItemsPublicView } from "@escaperoom/shared/templates";
import { Button } from "@/components/ui/button";
import { combinePair, toggleSelection } from "@/lib/playtest-state";

/** Item del catálogo resuelto para pintar (el host localiza `name`). */
export interface InventoryItemView {
  id: string;
  name: string;
  /** Frame del pack (`ItemDef.icon`); sin él se pinta un monograma. */
  icon?: string;
}

/** Resultado del último intento, tal como lo devolvió el servidor. */
export interface InventoryCombineFeedback {
  outcome: CombinationOutcome;
  output: string | null;
}

export interface InventoryPanelProps {
  /** Única fuente de verdad del panel: la proyección pública de `combine_items`. */
  view: CombineItemsPublicView;
  /** Catálogo de items para resolver id → nombre/icono. */
  items: InventoryItemView[];
  /** Envía la pareja al servidor; nunca se valida aquí. */
  onCombine: (a: string, b: string) => void;
  /** El host marca `true` mientras espera la respuesta del servidor. */
  pending?: boolean;
  /** Último resultado del servidor para pintar el feedback. */
  feedback?: InventoryCombineFeedback | null;
  /** Columnas de la rejilla de inventario (3 por defecto). */
  cols?: number;
  /** Filas de la rejilla de inventario (4 por defecto). */
  rows?: number;
  /** Render del icono de un item; por defecto, monograma de texto. */
  renderIcon?: (item: InventoryItemView) => ReactNode;
  /** Cierra el panel (botón superior). */
  onClose?: () => void;
  className?: string;
}

const DEFAULT_COLS = 3;
const DEFAULT_ROWS = 4;

/**
 * Panel de inventario y combinación del `combine_items` (specs/04 §8-UI,
 * specs/06 §2.4). Es puramente presentacional: solo lee `CombineItemsPublicView`
 * y delega cada pareja en `onCombine`; la validación de recetas y la posesión
 * viven en `@escaperoom/shared/templates` (servidor).
 *
 * Combinación con **dos vías equivalentes** (sin "zona de combinar" aparte):
 * arrastrar un item **sobre otro** del inventario, o seleccionar dos y pulsar
 * "Combinar". El nombre del item es pulsable (selecciona), no es decorativo.
 */
export function InventoryPanel({
  view,
  items,
  onCombine,
  pending = false,
  feedback = null,
  cols = DEFAULT_COLS,
  rows = DEFAULT_ROWS,
  renderIcon,
  onClose,
  className,
}: InventoryPanelProps) {
  const t = useTranslations("Inventory");
  const [staged, setStaged] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const catalog = new Map(items.map((item) => [item.id, item]));
  const unavailable = view.state === "locked" || view.state === "failed";
  const disabled = pending || unavailable;
  const totalSlots = Math.max(cols * rows, view.inventory.length);

  function labelFor(id: string): string {
    return catalog.get(id)?.name ?? t("unknownItem");
  }

  function toggleStaged(id: string) {
    if (disabled) return;
    setStaged((current) => toggleSelection(current, id));
  }

  function combine(pair: readonly string[]) {
    const resolved = combinePair(pair);
    if (!resolved) return;
    onCombine(resolved[0], resolved[1]);
    setStaged([]);
  }

  function dropOn(targetId: string, event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDropTargetId(null);
    const dragged = event.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    if (disabled || !dragged || dragged === targetId) return;
    combine([dragged, targetId]);
  }

  let status = t("hint");
  if (unavailable) status = t("unavailable");
  else if (feedback) {
    switch (feedback.outcome) {
      case "combined":
        status = t("combined", { item: labelFor(feedback.output ?? "") });
        break;
      case "already_applied":
        status = t("alreadyApplied", { item: labelFor(feedback.output ?? "") });
        break;
      case "invalid_combination":
        status = t("invalid");
        break;
      case "missing_items":
        status = t("missingItems");
        break;
      case "unavailable":
        status = t("unavailable");
        break;
    }
  }

  return (
    <section
      aria-label={t("title")}
      className={cn(
        "flex w-full max-w-sm flex-col gap-4 rounded-xl border border-white/10 bg-black/60 p-4 text-white backdrop-blur",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">
            {t("recipes", { found: view.appliedRecipeCount, total: view.recipeCount })}
          </span>
          {onClose ? (
            <Button size="xs" variant="overlayGhost" onClick={onClose}>
              {t("close")}
            </Button>
          ) : null}
        </div>
      </header>

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        role="list"
        aria-label={t("gridLabel")}
      >
        {Array.from({ length: totalSlots }, (_, index) => {
          const itemId = view.inventory[index];
          const item = itemId ? catalog.get(itemId) : undefined;
          const stagedItem = itemId !== undefined && staged.includes(itemId);
          const isDraggable = itemId !== undefined && !disabled;
          const isDropTarget = dropTargetId === itemId && draggingId !== itemId;

          return (
            <button
              key={index}
              type="button"
              role="listitem"
              draggable={isDraggable}
              disabled={itemId === undefined || disabled}
              aria-label={itemId ? labelFor(itemId) : t("emptySlot")}
              aria-pressed={stagedItem}
              data-item-id={itemId}
              data-drop-target={isDropTarget}
              onDragStart={(event) => {
                if (!itemId) return;
                setDraggingId(itemId);
                event.dataTransfer.setData("text/plain", itemId);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTargetId(null);
              }}
              onDragOver={(event) => {
                if (!itemId || disabled || !draggingId || draggingId === itemId) return;
                event.preventDefault();
                setDropTargetId(itemId);
              }}
              onDragLeave={() => {
                if (itemId) setDropTargetId((current) => (current === itemId ? null : current));
              }}
              onDrop={(event) => itemId && dropOn(itemId, event)}
              onClick={() => itemId && toggleStaged(itemId)}
              className={cn(
                "flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border p-1 text-center transition-colors",
                itemId === undefined
                  ? "border-dashed border-white/10 bg-white/[0.02]"
                  : "border-white/15 bg-white/5 hover:border-amber-300/50 hover:bg-white/10",
                stagedItem && "border-amber-300/70 bg-amber-300/10",
                isDropTarget && "border-amber-300 ring-2 ring-amber-300/50",
                isDraggable && "cursor-grab active:cursor-grabbing",
              )}
            >
              {itemId ? (
                <>
                  {renderIcon ? (
                    renderIcon({ id: itemId, name: labelFor(itemId), icon: item?.icon })
                  ) : (
                    <span
                      aria-hidden
                      className="grid size-7 place-items-center rounded-md bg-amber-200/15 text-xs font-semibold text-amber-100"
                    >
                      {labelFor(itemId).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="line-clamp-2 text-[0.65rem] leading-tight text-white/80">
                    {item?.name ?? t("unknownItem")}
                  </span>
                </>
              ) : (
                <span className="text-[0.6rem] text-white/20">·</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button
          className="flex-1"
          disabled={disabled || staged.length !== 2}
          onClick={() => combine(staged)}
        >
          {pending ? t("pending") : t("combine")}
        </Button>
        <Button
          variant="overlayGhost"
          disabled={disabled || staged.length === 0}
          onClick={() => setStaged([])}
        >
          {t("clear")}
        </Button>
      </div>

      <p
        aria-live="polite"
        className={cn(
          "text-center text-xs",
          feedback?.outcome === "combined" || feedback?.outcome === "already_applied"
            ? "text-emerald-300"
            : feedback
              ? "text-amber-300"
              : "text-white/50",
        )}
      >
        {status}
      </p>
    </section>
  );
}
