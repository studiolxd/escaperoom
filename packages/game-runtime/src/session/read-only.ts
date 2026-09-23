import type { NetworkGameClient } from "./network";

/**
 * Cliente de **observador** (ticket 5.9, specs/19 §2): envuelve el cliente de
 * red y convierte cada intención en un no-op. Es defensa en profundidad —la
 * `EventRoom` ya rechaza cualquier mensaje de un observador con
 * `PERMISSION_DENIED`—, así la vista de observador no puede enviar nada aunque
 * un componente llame a una acción por error. El estado y los eventos
 * difundidos siguen llegando igual.
 */
export function createReadOnlyGameClient(client: NetworkGameClient): NetworkGameClient {
  const noop = () => undefined;
  return {
    selfId: client.selfId,
    getSnapshot: () => client.getSnapshot(),
    subscribe: (listener) => client.subscribe(listener),
    onEvent: (listener) => client.onEvent(listener),
    leave: () => client.leave(),
    dispose: () => client.dispose(),
    startGame: noop,
    move: noop,
    interact: noop,
    useItem: noop,
    combine: noop,
    openPuzzle: noop,
    closePuzzle: noop,
    attempt: noop,
    setPlate: noop,
    requestSplitView: noop,
    requestHint: noop,
    sendChat: noop,
    requestMediaToken: noop,
  };
}
