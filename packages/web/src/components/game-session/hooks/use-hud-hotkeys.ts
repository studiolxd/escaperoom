import { useCallback, useEffect, useRef } from "react";

export interface DialogView {
  id: string;
  text: string;
}

/**
 * F-35: el listener global de teclado se registra una sola vez y lee estos
 * refs al pulsar, en vez de re-registrarse en cada cambio de
 * `dialog`/`inventoryOpen` (varias veces por interacción).
 *
 * F-17: el picker, el menú contextual, el inventario y el panel de puzzle son
 * `Popover`/`Dialog` de shadcn — cada uno gestiona su propio ESC (su `open`
 * controlado se cierra solo). Este listener global ya solo cubre el diálogo
 * de inspección (`dialog`, un `Button` simple sin ese mecanismo) y la tecla
 * `I` del inventario.
 */
export function useHudHotkeys(options: {
  dialog: DialogView | null;
  inventoryOpen: boolean;
  panelOpen: boolean;
  onCloseDialog: () => void;
  onOpenInventory: () => void;
  onCloseInventory: () => void;
}) {
  const dialogRef = useRef(options.dialog);
  dialogRef.current = options.dialog;
  const inventoryOpenRef = useRef(options.inventoryOpen);
  inventoryOpenRef.current = options.inventoryOpen;
  const panelOpenRef = useRef(options.panelOpen);
  panelOpenRef.current = options.panelOpen;

  const onCloseDialogRef = useRef(options.onCloseDialog);
  onCloseDialogRef.current = options.onCloseDialog;
  const onOpenInventoryRef = useRef(options.onOpenInventory);
  onOpenInventoryRef.current = options.onOpenInventory;
  const onCloseInventoryRef = useRef(options.onCloseInventory);
  onCloseInventoryRef.current = options.onCloseInventory;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "Escape") {
        if (dialogRef.current) onCloseDialogRef.current();
        return;
      }
      if (event.key === "i" || event.key === "I") {
        if (inventoryOpenRef.current) onCloseInventoryRef.current();
        else if (!panelOpenRef.current) onOpenInventoryRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** F-17: evita el doble cierre en cascada cuando el diálogo de inspección
   * está por encima de un `Popover`/`Dialog` (ESC cierra primero el diálogo). */
  const preventEscapeIfDialogOpen = useCallback((event: { preventDefault: () => void }) => {
    if (dialogRef.current) event.preventDefault();
  }, []);

  return { dialogRef, preventEscapeIfDialogOpen };
}
