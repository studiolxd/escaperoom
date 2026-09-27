import type { RuntimeObject } from "@escaperoom/game-runtime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export interface ContextMenuPopoverProps {
  object: RuntimeObject | undefined;
  isSolved: boolean;
  onOpenChange: (open: boolean) => void;
  onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
  objectName: (objectId: string) => string;
  onInspect: (objectId: string) => void;
  onPickItem: (objectId: string) => void;
  onOpenPanel: (puzzleId: string, objectId: string) => void;
  onCancel: () => void;
  inspectLabel: string;
  useItemLabel: string;
  openPanelLabel: string;
  cancelLabel: string;
}

/**
 * F-17 (revisión en vivo): menú contextual del objeto — `Dialog` modal, como
 * el resto de popups del HUD (bloquea clics de fondo) en vez del `Popover` no
 * modal anterior; su título es el nombre del objeto seleccionado.
 */
export function ContextMenuPopover({
  object,
  isSolved,
  onOpenChange,
  onEscapeKeyDown,
  objectName,
  onInspect,
  onPickItem,
  onOpenPanel,
  onCancel,
  inspectLabel,
  useItemLabel,
  openPanelLabel,
  cancelLabel,
}: ContextMenuPopoverProps) {
  return (
    <Dialog open={object !== undefined} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={onEscapeKeyDown}
        className="w-fit max-w-[min(92vw,26rem)] rounded-xl border border-amber-500/30 px-4 py-3 shadow-xl dark:border-amber-200/30"
      >
        {object ? (
          <>
            <DialogTitle className="font-mono text-sm">{objectName(object.id)}</DialogTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              {(object.actions ?? ["inspect", "use_item"]).map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant={action === "use_item" ? "default" : "secondary"}
                  onClick={() => {
                    if (action === "inspect") onInspect(object.id);
                    else onPickItem(object.id);
                  }}
                >
                  {action === "inspect" ? inspectLabel : useItemLabel}
                </Button>
              ))}
              {object.panelPuzzleId && !isSolved ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenPanel(object.panelPuzzleId!, object.id)}
                >
                  {openPanelLabel}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={onCancel}>
                {cancelLabel}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
