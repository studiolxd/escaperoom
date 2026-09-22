import Phaser from "phaser";
import type { RuntimeModel, RuntimeObject, RuntimeSubRoom } from "../loader";
import {
  buildCollisionGrid,
  buildPlaceholderManifest,
  resolveSpriteFrame,
  resolveTileFrame,
  type CollisionGrid,
  type PackManifest,
} from "../pack";
import { AvatarController } from "./avatar";
import {
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  gridBounds,
  gridCenter,
  isoDepth,
  tileAnchor,
  tileToWorld,
  worldToTile,
} from "./iso";
import { PackFrameResolver } from "./pack-textures";
import { playerColor } from "./palette";

/** Pack cargado por la escena: manifiesto + base de las imágenes de atlas. */
export interface RoomScenePack {
  manifest: PackManifest;
  /** URL base (sin barra final) donde viven las imágenes/JSON del pack. */
  baseUrl: string;
}

export interface RoomSceneOptions {
  model: RuntimeModel;
  /** Habitación inicial; por defecto la primera de `map.rooms`. */
  initialRoomId?: string;
  /** Muestra etiquetas de texto sobre objetos, decoración y spawns (debug). */
  showLabels?: boolean;
  /** Pack gráfico; si falta, se usa el manifiesto placeholder + texturas procedurales. */
  pack?: RoomScenePack;
  /** Muestra y controla un avatar jugable (por defecto `true`). */
  avatar?: boolean;
}

const DEPTH = {
  ground: 0,
  tileSub: 10,
  decorationSub: 20,
  objectSub: 30,
  ambient: 9000,
  halo: 9001,
} as const;

const FLOOR_TILE_SIZE = { width: ISO_TILE_WIDTH, height: ISO_TILE_HEIGHT };
const WALL_TILE_SIZE = { width: 64, height: 64 };
const SPRITE_SIZE = { width: 64, height: 96 };
const SPAWN_MARKER_DEPTH_SUB = 90;

/**
 * Escena del runtime de producto (modo play): pinta un `RuntimeSubRoom` con el
 * tilemap isométrico real (tiles + muros del pack, o placeholders automáticos),
 * depth-sort con sprites, colisiones por celda, avatar animado, cámara y
 * transición de sala (specs/04 §1, specs/26).
 *
 * El loader puro de 1.1 (`RuntimeModel`) es la única fuente del mundo; el pack
 * solo aporta frames. Sin pack, cada frame se sustituye por una textura de
 * color con su nombre, así que la sala se ve sin arte real.
 */
export class RoomScene extends Phaser.Scene {
  private readonly model: RuntimeModel;
  private readonly showLabels: boolean;
  private readonly pack?: RoomScenePack;
  private readonly avatarEnabled: boolean;
  private readonly manifest: PackManifest;

  private activeRoomId: string;
  private roomObjects: Phaser.GameObjects.GameObject[] = [];
  private ambientOverlay?: Phaser.GameObjects.Rectangle;
  private resolver!: PackFrameResolver;
  private collision!: CollisionGrid;
  private avatar?: AvatarController;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private movementKeys?: Record<"w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  private built = false;
  private transitioning = false;
  private doorCooldownUntil = 0;
  private clickTarget?: { x: number; y: number };

  constructor(options: RoomSceneOptions) {
    super("room-preview");
    this.model = options.model;
    this.showLabels = options.showLabels ?? false;
    this.pack = options.pack;
    this.avatarEnabled = options.avatar ?? true;
    this.manifest = options.pack?.manifest ?? buildPlaceholderManifest(options.model);

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

  preload(): void {
    if (!this.pack) {
      return;
    }
    const baseUrl = this.pack.baseUrl.replace(/\/$/, "");
    for (const atlas of this.pack.manifest.atlases) {
      this.load.atlas(atlas.key, `${baseUrl}/${atlas.image}`, `${baseUrl}/${atlas.data}`);
    }
  }

  create(): void {
    this.resolver = new PackFrameResolver(this, this.pack?.manifest);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    this.setupInput();
    this.buildRoom();
    this.cameras.main.fadeIn(200, 11, 17, 32);
  }

  update(time: number, delta: number): void {
    if (!this.built || this.transitioning || !this.avatar) {
      return;
    }
    this.avatar.update(delta, this.readMove());
    this.checkDoor(time);
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

    this.transitioning = true;
    const camera = this.cameras.main;
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.buildRoom();
      camera.fadeIn(200, 11, 17, 32);
      this.transitioning = false;
    });
    camera.fadeOut(140, 11, 17, 32);
  }

  private buildRoom(): void {
    this.clearRoom();

    const room = this.model.subroomsById[this.activeRoomId];
    if (!room) {
      throw new Error(`RoomScene: la habitación "${this.activeRoomId}" no existe.`);
    }

    this.collision = buildCollisionGrid(room, { manifest: this.manifest });
    this.drawGround(room);
    this.drawWalls(room);
    this.drawDecorations(room);
    this.drawObjects(room);
    if (this.showLabels) {
      this.drawSpawns(room);
    }
    this.drawLighting(room);
    this.applyCamera(room);
    this.buildAvatar(room);

    this.built = true;
  }

  private clearRoom(): void {
    this.avatar?.destroy();
    this.avatar = undefined;
    this.clickTarget = undefined;
    for (const object of this.roomObjects) {
      object.destroy();
    }
    this.roomObjects = [];
    this.ambientOverlay = undefined;
  }

  private teardown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.clearRoom();
  }

  private track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.roomObjects.push(object);
    return object;
  }

  /** Suelo: capa `ground` como tiles uniformes 64×32. */
  private drawGround(room: RuntimeSubRoom): void {
    const ground = room.layers.find((layer) => layer.name === "ground");
    if (!ground) {
      return;
    }

    for (let ty = 0; ty < room.height; ty += 1) {
      for (let tx = 0; tx < room.width; tx += 1) {
        const tileId = ground.tiles[ty * room.width + tx] ?? 0;
        if (tileId === 0) {
          continue;
        }
        const frame = resolveTileFrame(this.manifest, tileId);
        const ref = this.resolver.resolve(frame, FLOOR_TILE_SIZE);
        const { x, y } = tileToWorld(tx, ty);
        this.track(
          this.add.image(x, y, ref.key, ref.frame).setOrigin(0.5, 0.5).setDepth(DEPTH.ground),
        );
      }
    }
  }

  /** Muros y demás capas: sprites con overhang, pivote abajo-centro de la celda. */
  private drawWalls(room: RuntimeSubRoom): void {
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
          const frame = resolveTileFrame(this.manifest, tileId);
          const ref = this.resolver.resolve(frame, WALL_TILE_SIZE);
          const anchor = tileAnchor(tx, ty);
          this.track(
            this.add
              .image(anchor.x, anchor.y, ref.key, ref.frame)
              .setOrigin(0.5, 1)
              .setDepth(isoDepth(tx, ty, DEPTH.tileSub) + 1),
          );
        }
      }
    }
  }

  private drawDecorations(room: RuntimeSubRoom): void {
    for (const decoration of room.decorations) {
      const frame = resolveSpriteFrame(this.manifest, decoration.sprite);
      const ref = this.resolver.resolve(frame, SPRITE_SIZE);
      const anchor = tileAnchor(decoration.x, decoration.y);
      const depth = isoDepth(decoration.x, decoration.y, DEPTH.decorationSub) + 1;

      this.track(
        this.add.image(anchor.x, anchor.y, ref.key, ref.frame).setOrigin(0.5, 1).setDepth(depth),
      );

      if (this.showLabels) {
        this.label(decoration.sprite, anchor.x, anchor.y - SPRITE_SIZE.height, depth);
      }
    }
  }

  private drawObjects(room: RuntimeSubRoom): void {
    for (const object of room.objects) {
      const frame = resolveSpriteFrame(this.manifest, object.sprite);
      const ref = this.resolver.resolve(frame, SPRITE_SIZE);
      const anchor = tileAnchor(object.position.x, object.position.y);
      const depth = isoDepth(object.position.x, object.position.y, DEPTH.objectSub) + 1;

      this.track(
        this.add.image(anchor.x, anchor.y, ref.key, ref.frame).setOrigin(0.5, 1).setDepth(depth),
      );

      if (this.showLabels) {
        const suffix = object.lockedBy ? " (bloqueado)" : "";
        this.label(`${object.id}${suffix}`, anchor.x, anchor.y - SPRITE_SIZE.height, depth);
      }
    }
  }

  private drawSpawns(room: RuntimeSubRoom): void {
    for (const spawn of room.spawns) {
      const { x, y } = tileToWorld(spawn.x, spawn.y);
      const color = playerColor(spawn.playerIndex - 1);
      const depth = isoDepth(spawn.x, spawn.y, SPAWN_MARKER_DEPTH_SUB) + 1;

      const graphics = this.track(this.add.graphics());
      graphics.setDepth(depth);

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

      this.label(`P${spawn.playerIndex}`, x, y - halfH - 4, depth);
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
        halo.fillStyle(0xffd27f, 0.05);
        halo.fillCircle(x, y, ring * 42);
      }
    }
  }

  private buildAvatar(room: RuntimeSubRoom): void {
    if (!this.avatarEnabled) {
      return;
    }
    const spawn = room.spawns[0] ?? { x: 0, y: 0 };
    this.avatar = new AvatarController({
      scene: this,
      resolver: this.resolver,
      manifest: this.manifest,
      collision: this.collision,
      start: { x: spawn.x, y: spawn.y },
      tint: playerColor(0),
    });
  }

  private setupInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.handlePointerDown, this);
    });

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return;
    }
    this.cursors = keyboard.createCursorKeys();
    this.movementKeys = {
      w: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    keyboard.on("keydown-SPACE", () => this.avatar?.interact());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.removeAllListeners("keydown-SPACE");
    });
  }

  /** Clic para moverse: permite alcanzar celdas que las teclas diagonales no cubren. */
  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.avatar || this.transitioning) {
      return;
    }
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tile = worldToTile(world.x, world.y);
    if (this.collision.isWalkable(tile.tx, tile.ty)) {
      this.clickTarget = { x: tile.tx, y: tile.ty };
    }
  }

  private readMove(): { x: number; y: number } | null {
    const keyboardMove = this.readKeyboardMove();
    if (keyboardMove) {
      this.clickTarget = undefined;
      return keyboardMove;
    }

    if (this.clickTarget && this.avatar) {
      const cell = this.avatar.cellPosition;
      const dx = this.clickTarget.x - cell.x;
      const dy = this.clickTarget.y - cell.y;
      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
        this.clickTarget = undefined;
        return null;
      }
      return { x: Math.sign(dx), y: Math.sign(dy) };
    }

    return null;
  }

  private readKeyboardMove(): { x: number; y: number } | null {
    let x = 0;
    let y = 0;

    const up = this.cursors?.up.isDown || this.movementKeys?.w.isDown;
    const down = this.cursors?.down.isDown || this.movementKeys?.s.isDown;
    const left = this.cursors?.left.isDown || this.movementKeys?.a.isDown;
    const right = this.cursors?.right.isDown || this.movementKeys?.d.isDown;

    if (up) {
      x -= 1;
      y -= 1;
    }
    if (down) {
      x += 1;
      y += 1;
    }
    if (left) {
      x -= 1;
      y += 1;
    }
    if (right) {
      x += 1;
      y -= 1;
    }

    return x === 0 && y === 0 ? null : { x, y };
  }

  private checkDoor(time: number): void {
    if (!this.avatar || time < this.doorCooldownUntil) {
      return;
    }
    const room = this.model.subroomsById[this.activeRoomId];
    if (!room) {
      return;
    }
    const cell = this.avatar.gridCell;
    const door = room.objects.find(
      (object: RuntimeObject) =>
        object.leadsTo !== undefined &&
        Math.round(object.position.x) === cell.x &&
        Math.round(object.position.y) === cell.y,
    );
    if (door?.leadsTo) {
      this.doorCooldownUntil = time + 600;
      this.setRoom(door.leadsTo);
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
      this.fitZoom(bounds.width, bounds.height);
      this.cameras.main.centerOn(
        gridCenter(room.width, room.height).x,
        gridCenter(room.width, room.height).y,
      );
    }
  }
}

function parseColor(color: string): number {
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  const value = Number.parseInt(normalized, 16);
  return Number.isNaN(value) ? 0x000000 : value;
}
