/**
 * Eventos de mundo que la escena Phaser emite hacia la capa React (specs/03 §3).
 * La escena no conoce React: publica eventos tipados y `RoomRuntime` los
 * reenvía a quien los escuche. Así, los diálogos que abren un panel (p. ej.
 * `open_panel_puzzle`) los monta React sin acoplar Phaser al DOM.
 */

export const WORLD_EVENT = "world:event";

export type WorldSceneEvent =
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
