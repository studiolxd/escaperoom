import type { ReactNode } from "react";
import type { RuntimeModel } from "@escaperoom/game-runtime";
import type { CombineItemsPublicView } from "@escaperoom/shared/templates";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  InventoryPanel,
  type InventoryCombineFeedback,
} from "@/components/puzzles/inventory-panel";

export interface InventoryDialogProps {
  open: boolean;
  container: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
  model: RuntimeModel;
  view: CombineItemsPublicView | undefined;
  onCombine: (inputs: readonly string[]) => void;
  feedback: InventoryCombineFeedback | null;
  renderIcon: (itemId: string) => ReactNode;
  inventoryLabel: string;
  dragHintLabel: string;
  loadingLabel: string;
}

/** F-17: inventario — `Dialog` modal (bloquea el resto del HUD y atrapa el foco). */
export function InventoryDialog({
  open,
  container,
  onOpenChange,
  onEscapeKeyDown,
  model,
  view,
  onCombine,
  feedback,
  renderIcon,
  inventoryLabel,
  dragHintLabel,
  loadingLabel,
}: InventoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={container}
        onEscapeKeyDown={onEscapeKeyDown}
        data-testid="game-inventory-overlay"
        className="max-h-[calc(100%-2rem)] w-fit max-w-[calc(100%-2rem)] overflow-auto bg-transparent p-0 shadow-none ring-0"
      >
        <DialogTitle className="sr-only">{inventoryLabel}</DialogTitle>
        <DialogDescription className="sr-only">{dragHintLabel}</DialogDescription>
        {view ? (
          <InventoryPanel
            view={view}
            items={model.items.map((item) => ({
              id: item.id,
              name: item.name,
              icon: item.icon,
              content: item.content,
            }))}
            onCombine={onCombine}
            feedback={feedback}
            renderIcon={(item) => renderIcon(item.id)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{loadingLabel}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
