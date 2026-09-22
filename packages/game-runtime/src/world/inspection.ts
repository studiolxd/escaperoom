import { resolveLocalizedText, type RuntimeDialog, type RuntimeModel } from "../loader";
import { containerContents, type ContainerStateMap } from "./distribution";
import type { InspectionResult } from "./types";

/**
 * Inspección de objetos (specs/04 §4): al interactuar, el runtime muestra el
 * diálogo asociado por las reglas `on_interact` del paquete. La asociación la
 * deriva el loader (1.1); aquí se resuelve el texto al idioma activo **con
 * fallback** y se adjunta el contenido interno del objeto si es contenedor.
 *
 * Los diálogos que abren un panel devuelven `panelPuzzleId` para que la capa
 * React monte el panel (specs/03 §3).
 */

export interface InspectOptions {
  /** Idioma a resolver; por defecto `model.locale`. */
  locale?: string;
  /** Estado de los contenedores; si falta, se usa el `inventory` de la definición. */
  containers?: ContainerStateMap;
}

/** Inspecciona un objeto; devuelve `undefined` si el id no existe. */
export function inspectObject(
  model: RuntimeModel,
  objectId: string,
  options: InspectOptions = {},
): InspectionResult | undefined {
  const object = model.objectsById[objectId];
  if (!object) {
    return undefined;
  }

  const locale = options.locale ?? model.locale;
  const dialog = object.inspectDialogId
    ? resolveDialog(model, object.inspectDialogId, locale)
    : undefined;

  const hasInventory = (object.inventory?.length ?? 0) > 0;
  const contents = hasInventory
    ? options.containers
      ? containerContents(options.containers, objectId)
      : [...(object.inventory ?? [])]
    : undefined;

  return {
    objectId,
    interactable: object.interactable,
    conditioned: object.inspectConditioned === true,
    ...(object.inspectDialogId ? { dialogId: object.inspectDialogId } : {}),
    ...(dialog ? { dialog } : {}),
    ...(object.inspectPanelPuzzleId ? { panelPuzzleId: object.inspectPanelPuzzleId } : {}),
    ...(contents ? { contents } : {}),
    ...(hasInventory ? { distribution: object.distribution ?? "first_click" } : {}),
    ...(options.containers?.[objectId]
      ? { opened: options.containers[objectId]!.opened }
      : hasInventory
        ? { opened: false }
        : {}),
  };
}

/** Resuelve el `text` de un diálogo al locale pedido, con fallback al primero. */
export function resolveDialog(
  model: RuntimeModel,
  dialogId: string,
  locale: string,
): RuntimeDialog | undefined {
  const dialog = model.dialogsById[dialogId];
  if (!dialog) {
    return undefined;
  }
  return { ...dialog, text: resolveLocalizedText(dialog.localized, locale) };
}
