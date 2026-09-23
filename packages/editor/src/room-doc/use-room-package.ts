import { useMemo, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { docToRoomPackage, observeRoomDoc } from "./serialize";

/**
 * La sala del doc Yjs como `RoomPackage` en estado React. Cualquier mutación
 * (pintar, arrastrar, otra pestaña, el MCP) produce una nueva instantánea; el
 * runtime en modo edición y la palette se re-renderizan desde aquí.
 */
export function useRoomPackage(doc: Y.Doc): RoomPackage {
  const store = useMemo(() => {
    let snapshot = docToRoomPackage(doc);
    return {
      subscribe(onChange: () => void) {
        return observeRoomDoc(doc, () => {
          snapshot = docToRoomPackage(doc);
          onChange();
        });
      },
      getSnapshot: () => snapshot,
    };
  }, [doc]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
