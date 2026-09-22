import Phaser from "phaser";
import type { RuntimeModel, RuntimeObject, RuntimeSubRoom } from "../loader";
import {
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  gridBounds,
  gridCenter,
  isoDepth,
  tileToWorld,
} from "./iso";
import {
  DECORATION_COLOR,
  FLOOR_COLOR,
  FLOOR_COLOR_ALT,
  FLOOR_EDGE,
  objectColor,
  playerColor,
  tileColor,
} from "./palette";

export interface RoomSceneOptions {
  model: RuntimeModel;
  /** Habitación inicial; por defecto la primera de `map.rooms`. */
  initialRoomId?: string;
  /** Muestra etiquetas de texto sobre objetos, decoración y spawns. */
  showLabels?: boolean;
}

const DEPTH = {
  ambient: 9000,
  halo: 9001,
} as const;

const OBJECT_LEFT = 0x1f2937;
const OBJECT_RIGHT = 0x0f172a;

/** Altura de la caja isométrica por tipo de objeto (primitiva de 1.1). */
const OBJECT_HEIGHT: Record<string, number> = {
  puerta: 60,
  decorativo: 40,
  estatua: 52,
};

/**
 * Escena del runtime de producto (modo play) de 1.1: pinta un `RuntimeSubRoom`
 * con primitivas isométricas, ordena por profundidad (`isoDepth`), configura la
 * cámara para encuadrar la habitación y permite cambiar entre subrooms.
 *
 * Sin pack gráfico todavía (llega en 1.2): el suelo, los muros, la decoración y
 * los objetos se dibujan como rombos y cajas de color, con etiquetas para poder
 * validar visualmente el `RoomPackage` del Rey Aldric.
 */
export class RoomScene extends Phaser.Scene {
  private readonly model: RuntimeModel;
  private readonly showLabels: boolean;
  private activeRoomId: string;
  private roomObjects: Phaser.GameObjects.GameObject[] = [];
  private ambientOverlay?: Phaser.GameObjects.Rectangle;
  private built = false;

  constructor(options: RoomSceneOptions) {
    super("room-preview");
    this.model = options.model;
    this.showLabels = options.showLabels ?? true;

    const initialRoomId = options.initialRoomId ?? this.model.subrooms[0]?.id;
    if (!initialRoomId || !this.model.subroomsById[initialRoomId]) {
      throw new Error(
        `RoomScene: la habitación inicial "${initialRoomId ?? ""}" no existe en el modelo.`,
      );
    }
    this.activeRoomId = initialRoomId;
  }

  get currentRoomId(): string {
    return this.activeRoomId;
  }

  create(): void {
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.clearRoom();
    });

    this.buildRoom();
    this.cameras.main.fadeIn(200, 11, 17, 32);
  }

  /** Cambia de habitación con un fundido y reconstruye la escena. */
  setRoom(roomId: string): void {
    if (!this.model.subroomsById[roomId]) {
      throw new Error(`RoomScene: la habitación "${roomId}" no existe en el modelo.`);
    }
    if (roomId === this.activeRoomId && this.built) {
      return;
    }

    this.activeRoomId = roomId;
    if (!this.built) {
      return;
    }

    const camera = this.cameras.main;
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.buildRoom();
      camera.fadeIn(200, 11, 17, 32);
    });
    camera.fadeOut(140, 11, 17, 32);
  }

  private buildRoom(): void {
    this.clearRoom();

    const room = this.model.subroomsById[this.activeRoomId];
    if (!room) {
      throw new Error(`RoomScene: la habitación "${this.activeRoomId}" no existe.`);
    }

    this.drawGround(room);
    this.drawTiles(room);
    this.drawDecorations(room);
    this.drawSpawns(room);
    this.drawObjects(room);
    this.drawLighting(room);
    this.applyCamera(room);

    this.built = true;
  }

  private clearRoom(): void {
    for (const object of this.roomObjects) {
      object.destroy();
    }
    this.roomObjects = [];
    this.ambientOverlay = undefined;
  }

  private track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.roomObjects.push(object);
    return object;
  }

  private fillDiamond(
    graphics: Phaser.GameObjects.Graphics,
    tx: number,
    ty: number,
    color: number,
    offsetY = 0,
  ): void {
    const { x, y } = tileToWorld(tx, ty);
    const halfW = ISO_TILE_WIDTH / 2;
    const halfH = ISO_TILE_HEIGHT / 2;

    graphics.fillStyle(color, 1);
    graphics.lineStyle(1, FLOOR_EDGE, 0.5);
    graphics.beginPath();
    graphics.moveTo(x, y - halfH + offsetY);
    graphics.lineTo(x + halfW, y + offsetY);
    graphics.lineTo(x, y + halfH + offsetY);
    graphics.lineTo(x - halfW, y + offsetY);
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
  }

  /** Suelo: un único `Graphics` por debajo de todo, con tablero ajedrezado. */
  private drawGround(room: RuntimeSubRoom): void {
    const graphics = this.track(this.add.graphics());
    graphics.setDepth(isoDepth(0, 0) - 50);

    for (let ty = 0; ty < room.height; ty += 1) {
      for (let tx = 0; tx < room.width; tx += 1) {
        this.fillDiamond(graphics, tx, ty, (tx + ty) % 2 === 0 ? FLOOR_COLOR : FLOOR_COLOR_ALT);
      }
    }
  }

  /** Muros y demás capas, agrupados por celda para respetar el orden de capas. */
  private drawTiles(room: RuntimeSubRoom): void {
    const byCell = new Map<string, Phaser.GameObjects.Graphics>();

    for (const layer of room.layers) {
      if (layer.name === "ground") {
        continue;
      }
      for (let ty = 0; ty < room.height; ty += 1) {
        for (let tx = 0; tx < room.width; tx += 1) {
          const tileId = layer.tiles[ty * room.width + tx] ?? 0;
          if (tileId === 0) {
            continue;
          }

          const key = `${tx},${ty}`;
          let graphics = byCell.get(key);
          if (!graphics) {
            graphics = this.track(this.add.graphics());
            graphics.setDepth(isoDepth(tx, ty, 0));
            byCell.set(key, graphics);
          }
          this.fillDiamond(graphics, tx, ty, tileColor(tileId));
        }
      }
    }
  }

  private drawDecorations(room: RuntimeSubRoom): void {
    for (const decoration of room.decorations) {
      const { x, y } = tileToWorld(decoration.x, decoration.y);
      const graphics = this.track(this.add.graphics());
      graphics.setDepth(isoDepth(decoration.x, decoration.y, -1));

      graphics.fillStyle(DECORATION_COLOR, 0.9);
      graphics.fillRect(x - 8, y - 44, 16, 32);
      graphics.lineStyle(1, FLOOR_EDGE, 0.8);
      graphics.strokeRect(x - 8, y - 44, 16, 32);

      if (this.showLabels) {
        this.label(decoration.sprite, x, y - 46, isoDepth(decoration.x, decoration.y, -1));
      }
    }
  }

  private drawSpawns(room: RuntimeSubRoom): void {
    for (const spawn of room.spawns) {
      const { x, y } = tileToWorld(spawn.x, spawn.y);
      const color = playerColor(spawn.playerIndex - 1);

      const graphics = this.track(this.add.graphics());
      graphics.setDepth(isoDepth(spawn.x, spawn.y, 10));

      const halfW = ISO_TILE_WIDTH / 2 - 6;
      const halfH = ISO_TILE_HEIGHT / 2 - 3;
      graphics.fillStyle(color, 0.28);
      graphics.lineStyle(2, color, 0.95);
      graphics.beginPath();
      graphics.moveTo(x, y - halfH);
      graphics.lineTo(x + halfW, y);
      graphics.lineTo(x, y + halfH);
      graphics.lineTo(x - halfW, y);
      graphics.closePath();
      graphics.fillPath();
      graphics.strokePath();

      this.track(this.add.circle(x, y - 14, 9, color, 1).setStrokeStyle(2, 0xe0f2fe, 0.9));
      this.track(this.add.ellipse(x, y + 2, 26, 11, 0x000000, 0.3));

      if (this.showLabels) {
        this.label(`P${spawn.playerIndex}`, x, y - 30, isoDepth(spawn.x, spawn.y, 10));
      }
    }
  }

  private drawObjects(room: RuntimeSubRoom): void {
    for (const object of room.objects) {
      this.drawObjectBox(object);
    }
  }

  private drawObjectBox(object: RuntimeObject): void {
    const { x, y } = tileToWorld(object.position.x, object.position.y);
    const height = OBJECT_HEIGHT[object.type] ?? 46;
    const halfW = ISO_TILE_WIDTH / 2 - 4;
    const halfH = ISO_TILE_HEIGHT / 2 - 2;
    const top = objectColor(object.type);

    const graphics = this.track(this.add.graphics());
    graphics.setDepth(isoDepth(object.position.x, object.position.y, 50));

    graphics.fillStyle(OBJECT_LEFT, 0.95);
    graphics.beginPath();
    graphics.moveTo(x - halfW, y - height);
    graphics.lineTo(x, y - height + halfH);
    graphics.lineTo(x, y + halfH);
    graphics.lineTo(x - halfW, y);
    graphics.closePath();
    graphics.fillPath();

    graphics.fillStyle(OBJECT_RIGHT, 0.95);
    graphics.beginPath();
    graphics.moveTo(x + halfW, y - height);
    graphics.lineTo(x, y - height + halfH);
    graphics.lineTo(x, y + halfH);
    graphics.lineTo(x + halfW, y);
    graphics.closePath();
    graphics.fillPath();

    graphics.fillStyle(top, 1);
    graphics.beginPath();
    graphics.moveTo(x, y - height - halfH);
    graphics.lineTo(x + halfW, y - height);
    graphics.lineTo(x, y - height + halfH);
    graphics.lineTo(x - halfW, y - height);
    graphics.closePath();
    graphics.fillPath();

    if (this.showLabels) {
      const suffix = object.lockedBy ? " (bloqueado)" : "";
      this.label(
        `${object.id}${suffix}`,
        x,
        y - height - halfH - 4,
        isoDepth(object.position.x, object.position.y, 50),
      );
    }
  }

  private drawLighting(room: RuntimeSubRoom): void {
    const ambient = room.lighting.find((light) => light.type === "ambient");
    if (ambient && ambient.type === "ambient") {
      this.ambientOverlay = this.track(
        this.add
          .rectangle(0, 0, this.scale.width, this.scale.height, parseColor(ambient.color), 1)
          .setOrigin(0, 0)
          .setScrollFactor(0)
          .setDepth(DEPTH.ambient)
          .setBlendMode(Phaser.BlendModes.MULTIPLY)
          .setAlpha(Phaser.Math.Clamp(ambient.intensity, 0, 1) * 0.7),
      );
    }

    for (const light of room.lighting) {
      if (light.type !== "torch") {
        continue;
      }
      const { x, y } = tileToWorld(light.x, light.y);
      const halo = this.track(this.add.graphics());
      halo.setDepth(DEPTH.halo).setBlendMode(Phaser.BlendModes.ADD);

      for (let ring = 4; ring >= 1; ring -= 1) {
        const radius = ring * 42;
        halo.fillStyle(0xffd27f, 0.05);
        halo.fillCircle(x, y, radius);
      }
    }
  }

  private applyCamera(room: RuntimeSubRoom): void {
    const camera = this.cameras.main;
    const bounds = gridBounds(room.width, room.height, 1);
    const center = gridCenter(room.width, room.height);

    camera.setBackgroundColor("#0b1120");
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    camera.centerOn(center.x, center.y);
    this.fitZoom(bounds.width, bounds.height);
  }

  private fitZoom(contentWidth: number, contentHeight: number): void {
    const camera = this.cameras.main;
    if (contentWidth <= 0 || contentHeight <= 0) {
      return;
    }
    const zoom = Math.min(camera.width / contentWidth, camera.height / contentHeight) * 0.92;
    camera.setZoom(Phaser.Math.Clamp(zoom, 0.35, 2));
  }

  private label(text: string, x: number, y: number, depth: number): void {
    const label = this.add
      .text(x, y, text, {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "11px",
        color: "#e2e8f0",
        align: "center",
      })
      .setOrigin(0.5, 1)
      .setAlpha(0.75)
      .setDepth(depth);
    this.track(label);
  }

  private handleResize(): void {
    if (this.ambientOverlay) {
      this.ambientOverlay.setSize(this.scale.width, this.scale.height);
    }
    const room = this.model.subroomsById[this.activeRoomId];
    if (room) {
      const bounds = gridBounds(room.width, room.height, 1);
      const center = gridCenter(room.width, room.height);
      this.fitZoom(bounds.width, bounds.height);
      this.cameras.main.centerOn(center.x, center.y);
    }
  }
}

function parseColor(color: string): number {
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  const value = Number.parseInt(normalized, 16);
  return Number.isNaN(value) ? 0x000000 : value;
}
