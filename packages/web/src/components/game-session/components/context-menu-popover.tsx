import { useRef } from "react";
import type { RuntimeObject } from "@escaperoom/game-runtime";
import { Button } from "@/components/ui/button";
import { useArrowNavigation } from "../hooks/use-arrow-navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export interface ContextMenuPopoverProps {
  object: RuntimeObject | undefined;
  /**
   * Objetos interactuables en la misma celda que `object` (él incluido,
   * `colocatedInteractables`). Con más de uno, el menú deja elegir a cuál se
   * aplica la acción: un clic en el canvas solo acierta al de encima.
   */
  alternatives?: readonly RuntimeObject[];
  onSelectObject?: (objectId: string) => void;
  onOpenChange: (open: boolean) => void;
  onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
  objectName: (objectId: string) => string;
  onInspect: (objectId: string) => void;
  onPickItem: (objectId: string) => void;
  onCancel: () => void;
  inspectLabel: string;
  useItemLabel: string;
  cancelLabel: string;
  /** Objeto "caído en el suelo" (`pickupObjectId` de un `hidden_key`): solo Recoger + Cancelar. */
  pickupLabel: string;
  alternativesLabel?: string;
}

/**
 * F-17 (revisión en vivo): menú contextual del objeto — `Dialog` modal, como
 * el resto de popups del HUD (bloquea clics de fondo) en vez del `Popover` no
 * modal anterior; su título es el nombre del objeto seleccionado.
 *
 * Sin botón "Abrir panel" (revisión en vivo, quitado): "Inspeccionar" ya abre
 * el panel del puzzle asociado (`useGameHud.inspect`) para cualquier objeto
 * que no sea un `hidden_key` (ese se revela al inspeccionar, sin panel
 * manual) — el botón era una segunda vía redundante o, para un `hidden_key`,
 * abría un panel que no debía existir en absoluto (p. ej. `cuadro-aurelio`).
 *
 * Si hay varios objetos apilados en la misma celda (`alternatives`), un
 * grupo de botones con sus nombres deja cambiar a cuál se aplica la acción
 * (sin panel de objetos, era la única forma de llegar a los de debajo).
 */
export function ContextMenuPopover({
  object,
  onOpenChange,
  onEscapeKeyDown,
  objectName,
  onInspect,
  onPickItem,
  onCancel,
  inspectLabel,
  useItemLabel,
  cancelLabel,
  pickupLabel,
  alternatives = [],
  onSelectObject,
  alternativesLabel,
}: ContextMenuPopoverProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Flechas (izq./der. y arriba/abajo) recorren Objetos apilados → acciones →
  // Cancelar, dando la vuelta; Espacio/Intro pulsan el botón con foco.
  useArrowNavigation({
    containerRef: menuRef,
    selector: "button",
    wrap: true,
    enabled: object !== undefined,
  });
  return (
    <Dialog open={object !== undefined} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={onEscapeKeyDown}
        onOpenAutoFocus={(event) => {
          // Foco inicial en la primera acción (no en un objeto apilado).
          event.preventDefault();
          menuRef.current?.querySelector<HTMLElement>("[data-menu-action]")?.focus();
        }}
        className="w-fit max-w-[min(92vw,26rem)] rounded-xl border border-amber-500/30 px-4 py-3 shadow-xl dark:border-amber-200/30"
      >
        {object ? (
          <div ref={menuRef}>
            <DialogTitle className="font-mono text-sm">{objectName(object.id)}</DialogTitle>
            {alternatives.length > 1 ? (
              <div role="group" aria-label={alternativesLabel} className="mt-2 flex flex-wrap gap-1.5">
                {alternatives.map((candidate) => {
                  const current = candidate.id === object.id;
                  return (
                    <Button
                      key={candidate.id}
                      size="sm"
                      variant={current ? "secondary" : "outline"}
                      aria-pressed={current}
                      onClick={() => onSelectObject?.(candidate.id)}
                    >
                      {objectName(candidate.id)}
                    </Button>
                  );
                })}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {(object.actions ?? ["inspect", "use_item"]).map((action) => (
                <Button
                  key={action}
                  data-menu-action
                  size="sm"
                  variant={action === "use_item" ? "default" : "secondary"}
                  onClick={() => {
                    if (action === "use_item") onPickItem(object.id);
                    else onInspect(object.id);
                  }}
                >
                  {action === "use_item" ? useItemLabel : action === "pickup" ? pickupLabel : inspectLabel}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={onCancel}>
                {cancelLabel}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
