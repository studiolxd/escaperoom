import Phaser from "phaser";
import type { RuntimeModel } from "../loader";
import { RoomScene } from "./room-scene";

export interface RoomRuntimeOptions {
  /** Habitación inicial; por defecto la primera del paquete. */
  initialRoomId?: string;
  /** Muestra etiquetas de texto sobre objetos, decoración y spawns. */
  showLabels?: boolean;
}

/**
 * Controlador del runtime de producto: monta Phaser en un contenedor del DOM,
 * registra `RoomScene` con el modelo cargado y expone el cambio de habitación.
 * La capa React solo necesita una instancia y llamar a `showRoom`/`destroy`.
 */
export class RoomRuntime {
  readonly scene: RoomScene;
  private readonly game: Phaser.Game;

  constructor(parent: HTMLElement, model: RuntimeModel, options: RoomRuntimeOptions = {}) {
    this.scene = new RoomScene({
      model,
      initialRoomId: options.initialRoomId,
      showLabels: options.showLabels,
    });

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: "#0b1120",
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: "100%",
        height: "100%",
      },
      render: { antialias: true, pixelArt: false },
      scene: [this.scene],
    });
  }

  get currentRoomId(): string {
    return this.scene.currentRoomId;
  }

  /** Cambia la habitación activa con un fundido. */
  showRoom(roomId: string): void {
    this.scene.setRoom(roomId);
  }

  /** Destruye el juego Phaser y libera el canvas. */
  destroy(): void {
    this.game.destroy(true);
  }
}
