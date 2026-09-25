import { useMemo, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import {
  buildRoomDialogs,
  buildRoomHints,
  buildRoomItems,
  buildRoomMap,
  buildRoomObjects,
  buildRoomPuzzles,
  observeRoomDocRoots,
  roomDocToPackage,
  type RoomDocRoot,
} from "./serialize";
import { readRules } from "../rules-graph/yjs-rules";
import { ROOM_DOC_KEYS } from "./doc-model";

/**
 * La sala del doc Yjs como `RoomPackage` en estado React. Cualquier mutación
 * (pintar, arrastrar, otra pestaña, el MCP) produce una nueva instantánea; el
 * runtime en modo edición y la palette se re-renderizan desde aquí.
 *
 * Memoiza por colección (auditoría D-17): antes, CUALQUIER transacción
 * reserializaba el `RoomPackage` entero (`roomDocToPackage`) — una pincelada
 * solo toca `subrooms`, pero recalculaba también objetos, items, puzzles,
 * reglas, diálogos y pistas. Ahora solo se recalculan los campos cuya raíz
 * Yjs cambió en la transacción; el resto conserva la MISMA referencia del
 * snapshot anterior (importa para `React.memo`/`useMemo` corriente abajo).
 */
export function useRoomPackage(doc: Y.Doc): RoomPackage {
  const store = useMemo(() => {
    let snapshot = roomDocToPackage(doc);

    const recompute = (dirty: ReadonlySet<RoomDocRoot>): RoomPackage => {
      const next: RoomPackage = { ...snapshot };
      const metaChanged = dirty.has(ROOM_DOC_KEYS.meta);
      // `meta` primero: si cambia (p. ej. `languages`), los textos
      // localizados de items/dialogs/hints dependen de ella aunque su propia
      // raíz no haya cambiado en esta transacción.
      if (metaChanged) next.meta = roomDocToPackage(doc).meta;
      const languages = next.meta.languages;
      if (dirty.has(ROOM_DOC_KEYS.map) || dirty.has(ROOM_DOC_KEYS.subrooms)) {
        next.map = buildRoomMap(doc);
      }
      if (dirty.has(ROOM_DOC_KEYS.objects)) next.objects = buildRoomObjects(doc);
      if (dirty.has(ROOM_DOC_KEYS.items) || metaChanged) {
        next.items = buildRoomItems(doc, languages);
      }
      if (dirty.has(ROOM_DOC_KEYS.puzzles)) next.puzzles = buildRoomPuzzles(doc);
      if (dirty.has(ROOM_DOC_KEYS.rules)) next.rules = readRules(doc);
      if (dirty.has(ROOM_DOC_KEYS.dialogs) || metaChanged) {
        next.dialogs = buildRoomDialogs(doc, languages);
      }
      if (dirty.has(ROOM_DOC_KEYS.hints) || metaChanged) {
        next.hints = buildRoomHints(doc, languages);
      }
      return next;
    };

    return {
      subscribe(onChange: () => void) {
        return observeRoomDocRoots(doc, (dirty) => {
          snapshot = recompute(dirty);
          onChange();
        });
      },
      getSnapshot: () => snapshot,
    };
  }, [doc]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
