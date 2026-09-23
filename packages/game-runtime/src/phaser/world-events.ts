/**
 * Eventos de mundo que la escena Phaser emite hacia la capa React (specs/03 §3).
 * La escena no conoce React: publica eventos tipados y `RoomRuntime` los
 * reenvía a quien los escuche. Así, los diálogos que abren un panel (p. ej.
 * `open_panel_puzzle`) los monta React sin acoplar Phaser al DOM.
 *
 * En el modo dirigido por motor (`intentOnly`) la escena **no resuelve** la
 * interacción: emite la intención `interact` / `use-item` y es la capa React
 * (a través de `RoomSession`) quien resuelve diálogo, estado y panel. Los
 * eventos `dialog`/`collect`/`open-panel`/`state` quedan para el modo
 * autocontenido de las previsualizaciones puras del mundo (ticket 1.3).
 */

export const WORLD_EVENT = "world:event";

export type WorldSceneEvent =
  /** Intención: el jugador ha seleccionado un objeto (clic o Espacio cerca). */
  | { type: "interact"; objectId: string }
  /** Intención: el jugador ha soltado un item del inventario sobre un objeto. */
  | { type: "use-item"; itemId: string; objectId: string }
  /** El avatar cruzó una puerta abierta: la capa React informa a `RoomSession`. */
  | { type: "enter-room"; roomId: string; fromRoomId: string }
  | {
      type: "dialog";
      objectId: string;
      dialogId?: string;
      /** Texto ya resuelto al idioma del modelo. */
      text: string;
      panelPuzzleId?: string;
      conditioned: boolean;
    }
  | { type: "open-panel"; objectId: string; puzzleId: string }
  | { type: "collect"; objectId: string; playerId: string; items: string[] }
  | { type: "state"; objectId: string; state: string };
