import type { RuntimeObject } from "@escaperoom/game-runtime";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTitle } from "@/components/ui/popover";

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
  titleLabel: string;
  objectLabel: (object: string) => string;
  inspectLabel: string;
  useItemLabel: string;
  openPanelLabel: string;
  cancelLabel: string;
}

/**
 * F-17: menú contextual del objeto — `Popover` no modal (el jugador sigue
 * viendo el mundo; el input ya se desactiva mientras está abierto vía
 * `worldInputEnabled`), en vez de un `div` sin foco ni rol.
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
  titleLabel,
  objectLabel,
  inspectLabel,
  useItemLabel,
  openPanelLabel,
  cancelLabel,
}: ContextMenuPopoverProps) {
  return (
    <Popover open={object !== undefined} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-4 bottom-52 mx-auto block h-px w-full max-w-[min(92vw,26rem)]"
        />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        onEscapeKeyDown={onEscapeKeyDown}
        className="w-fit max-w-[min(92vw,26rem)] rounded-xl border border-amber-200/30 bg-slate-950/95 px-4 py-3 text-white shadow-xl"
      >
        {object ? (
          <>
            <PopoverTitle className="block text-[0.65rem] font-normal uppercase tracking-wide text-amber-200/70">
              {titleLabel}
            </PopoverTitle>
            <span className="block font-mono text-xs text-white/60">{objectLabel(objectName(object.id))}</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {(object.actions ?? ["inspect", "use_item"]).map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant={action === "use_item" ? "default" : "overlay"}
                  onClick={() => {
                    if (action === "inspect") onInspect(object.id);
                    else onPickItem(object.id);
                  }}
                >
                  {action === "inspect" ? inspectLabel : useItemLabel}
                </Button>
              ))}
              {object.panelPuzzleId && !isSolved ? (
                <Button size="sm" variant="overlay" onClick={() => onOpenPanel(object.panelPuzzleId!, object.id)}>
                  {openPanelLabel}
                </Button>
              ) : null}
              <Button size="sm" variant="overlayGhost" onClick={onCancel}>
                {cancelLabel}
              </Button>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
