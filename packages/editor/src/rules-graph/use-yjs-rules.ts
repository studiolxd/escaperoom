import { useMemo, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { observeRules, readRules } from "./yjs-rules";
import type { Rule } from "./vocabulary";

/**
 * Reglas del doc Yjs como estado React. Cualquier mutación del mapa `rules`
 * (clic en el grafo, otra pestaña, una tool call del MCP) produce una nueva
 * instantánea y re-renderiza: no hay sincronización a mano.
 */
export function useYjsRules(doc: Y.Doc): Rule[] {
  const store = useMemo(() => {
    let snapshot = readRules(doc);
    return {
      subscribe(onChange: () => void) {
        return observeRules(doc, () => {
          snapshot = readRules(doc);
          onChange();
        });
      },
      getSnapshot: () => snapshot,
    };
  }, [doc]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
