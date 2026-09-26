import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTitle } from "@/components/ui/popover";

export interface ItemPickerPopoverProps {
  objectId: string | null;
  inventory: readonly string[];
  onOpenChange: (open: boolean) => void;
  onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
  onChoose: (itemId: string) => void;
  onCancel: () => void;
  renderItemIcon: (itemId: string, size?: number) => ReactNode;
  itemName: (itemId: string) => string;
  objectName: (objectId: string) => string;
  titleLabel: (object: string) => string;
  dragHintLabel: string;
  noItemsLabel: string;
  cancelLabel: string;
}

/**
 * F-17: picker de objeto — mismo `Popover` no modal que el menú contextual
 * (el jugador puede seguir arrastrando desde el inventario).
 */
export function ItemPickerPopover({
  objectId,
  inventory,
  onOpenChange,
  onEscapeKeyDown,
  onChoose,
  onCancel,
  renderItemIcon,
  itemName,
  objectName,
  titleLabel,
  dragHintLabel,
  noItemsLabel,
  cancelLabel,
}: ItemPickerPopoverProps) {
  return (
    <Popover open={objectId !== null} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-4 bottom-52 mx-auto block h-px w-full max-w-[min(92vw,30rem)]"
        />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        onEscapeKeyDown={onEscapeKeyDown}
        className="w-fit max-w-[min(92vw,30rem)] rounded-xl border border-amber-200/30 bg-slate-950/95 px-4 py-3 text-white shadow-xl"
      >
        {objectId ? (
          <>
            <PopoverTitle className="block text-[0.65rem] font-normal uppercase tracking-wide text-amber-200/70">
              {titleLabel(objectName(objectId))}
            </PopoverTitle>
            <p className="mt-1 text-[0.7rem] text-white/50">{dragHintLabel}</p>
            {inventory.length === 0 ? (
              <p className="mt-2 text-xs text-white/40">{noItemsLabel}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {inventory.map((itemId) => (
                  <Button key={itemId} size="sm" variant="overlay" onClick={() => onChoose(itemId)}>
                    {renderItemIcon(itemId, 28)}
                    {itemName(itemId)}
                  </Button>
                ))}
              </div>
            )}
            <Button size="sm" variant="overlayGhost" className="mt-2" onClick={onCancel}>
              {cancelLabel}
            </Button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
