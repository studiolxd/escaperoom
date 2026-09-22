import Phaser from "phaser";
import type { RuntimeModel } from "../loader";
import { RoomScene, type RoomScenePack } from "./room-scene";
import { WORLD_EVENT, type WorldSceneEvent } from "./world-events";

export interface RoomRuntimeOptions {
  /** Habitación inicial; por defecto la primera del paquete. */
  initialRoomId?: string;
  /** Muestra etiquetas de texto sobre objetos, decoración y spawns (debug). */
  showLabels?: boolean;
  /** Pack gráfico (manifiesto + URL base); sin él, placeholders automáticos. */
  pack?: RoomScenePack;
  /** Muestra y controla un avatar jugable (por defecto `true`). */
  avatar?: boolean;
  /** Dibuja el diálogo de inspección dentro de Phaser (por defecto `true`). */
  dialogOverlay?: boolean;
  /**
   * Modo dirigido por motor: la escena emite intenciones (`interact`,
   * `use-item`) en lugar de resolver la inspección por su cuenta. Lo usa la
   * capa React que ejecuta `RoomSession`.
   */
  intentOnly?: boolean;
  /** Control del jugador activo (por defecto `true`); la intro lo desactiva. */
  inputEnabled?: boolean;
  /** Id del jugador local, para el reparto de inventario (`distribution`). */
  localPlayerId?: string;
}

/**
 * Controlador del runtime de producto: monta Phaser en un contenedor del DOM,
 * registra `RoomScene` con el modelo cargado y expone el cambio de habitación.
 * La capa React solo necesita una instancia y llamar a `showRoom`/`destroy`.
 *
 * El pack gráfico se carga dentro de `preload` de la escena; si no se pasa
 * `pack` (o sus atlas fallan), la escena dibuja placeholders procedurales.
 */
export class RoomRuntime {
  readonly scene: RoomScene;
  private readonly game: Phaser.Game;

  constructor(parent: HTMLElement, model: RuntimeModel, options: RoomRuntimeOptions = {}) {
    this.scene = new RoomScene({
      model,
      initialRoomId: options.initialRoomId,
      showLabels: options.showLabels,
      pack: options.pack,
      avatar: options.avatar,
      dialogOverlay: options.dialogOverlay,
      intentOnly: options.intentOnly,
      inputEnabled: options.inputEnabled,
      localPlayerId: options.localPlayerId,
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

  /** Cambia el estado de un objeto del mundo (lo usará el motor de reglas). */
  setObjectState(objectId: string, state: string): void {
    this.scene.setObjectState(objectId, state);
  }

  /** Inspecciona un objeto como si el jugador lo hubiera pulsado. */
  inspectObject(objectId: string): void {
    this.scene.inspectObjectById(objectId);
  }

  /**
   * Activa o desactiva el control del jugador (movimiento e interacción). La
   * intro lo desactiva hasta cerrarse; el HUD del inventario también, para que
   * los clics no se cuelen al mundo (specs/04 §4).
   */
  setInputEnabled(enabled: boolean): void {
    this.scene.setInputEnabled(enabled);
  }

  /**
   * Suelta un item del inventario en coordenadas de pantalla (drag&drop): la
   * escena localiza el objeto bajo el puntero y emite `use-item`.
   */
  dropItemAt(itemId: string, screenX: number, screenY: number): string | undefined {
    return this.scene.dropItemAt(itemId, screenX, screenY);
  }

  /**
   * Suscribe un manejador a los eventos de mundo (diálogo, panel, recogida,
   * estado). Devuelve la función para cancelar la suscripción.
   *
   * `scene.events` solo existe cuando Phaser arranca (se inyecta en el evento
   * `READY` del juego), así que si aún no está listo se difiere la suscripción.
   */
  onWorldEvent(handler: (event: WorldSceneEvent) => void): () => void {
    const scene = this.scene;
    if (scene.events) {
      scene.events.on(WORLD_EVENT, handler);
      return () => {
        scene.events.off(WORLD_EVENT, handler);
      };
    }

    let attached = false;
    const attach = () => {
      if (attached) {
        return;
      }
      attached = true;
      scene.events.on(WORLD_EVENT, handler);
    };
    this.game.events.once(Phaser.Core.Events.READY, attach);

    return () => {
      this.game.events.off(Phaser.Core.Events.READY, attach);
      if (attached) {
        scene.events.off(WORLD_EVENT, handler);
      }
    };
  }

  /** Destruye el juego Phaser y libera el canvas. */
  destroy(): void {
    this.game.destroy(true);
  }
}
