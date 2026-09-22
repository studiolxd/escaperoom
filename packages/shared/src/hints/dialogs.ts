import type { DialogDef, RuleCondition } from "../schemas";
import {
  DEFAULT_LOCALE,
  resolveLocalizedEntry,
  type ResolvedLocalizedEntry,
} from "./localized-text";

/**
 * Diálogos (specs/05 §3 `show_dialog`, specs/08 §2.3): resolución pura de un
 * `DialogDef` al idioma activo con fallback. Las `conditions` opcionales las
 * evalúa el motor de reglas (ticket 1.4): aquí solo se conservan y se ofrece
 * un predicado para que el host decida si el diálogo aplica.
 */

/** Diálogo con el texto resuelto al idioma pedido. */
export interface ResolvedDialog extends ResolvedLocalizedEntry {
  id: string;
  /** Condiciones declaradas, si las hay; las evalúa el motor (1.4). */
  conditions?: RuleCondition[];
}

/** `true` si el diálogo declara condiciones que el motor debe evaluar. */
export function isDialogConditioned(dialog: DialogDef): boolean {
  return (dialog.conditions?.length ?? 0) > 0;
}

/**
 * Resuelve el texto de un `DialogDef` al idioma pedido con fallback (`es` por
 * defecto) y conserva sus condiciones si las declara.
 */
export function resolveDialog(
  dialog: DialogDef,
  locale: string,
  fallbackLocale: string = DEFAULT_LOCALE,
): ResolvedDialog {
  const resolved = resolveLocalizedEntry(dialog.text, locale, fallbackLocale);
  return {
    ...resolved,
    id: dialog.id,
    ...(dialog.conditions ? { conditions: dialog.conditions } : {}),
  };
}

/** Busca un diálogo por id en el catálogo del `RoomPackage`. */
export function findDialog(dialogs: readonly DialogDef[], dialogId: string): DialogDef | undefined {
  return dialogs.find((dialog) => dialog.id === dialogId);
}

/** Resuelve un diálogo por id; `undefined` si no existe en el catálogo. */
export function resolveDialogById(
  dialogs: readonly DialogDef[],
  dialogId: string,
  locale: string,
  fallbackLocale: string = DEFAULT_LOCALE,
): ResolvedDialog | undefined {
  const dialog = findDialog(dialogs, dialogId);
  return dialog ? resolveDialog(dialog, locale, fallbackLocale) : undefined;
}

/**
 * `true` si el diálogo encaja con el contexto evaluado por `matches`. Un
 * diálogo sin condiciones siempre encaja. La evaluación real de reglas vive en
 * el motor (1.4); aquí se delega en el predicado del host.
 */
export function dialogMatches(
  dialog: DialogDef,
  matches: (condition: RuleCondition) => boolean,
): boolean {
  return (dialog.conditions ?? []).every(matches);
}
