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
import {
  approachCell,
  collectContainer,
  containerContents,
  createContainerStateMap,
  createObjectStateMap,
  currentObjectState,
  inspectObject,
  nearestInteractable,
  reactiveObjectIds,
  resolveObjectStateAnimation,
  resolveTorchLights,
  resolveWaterChannels,
  resolveObjectStateSprite,
  setObjectState as applyObjectState,
  type ContainerStateMap,
  type ObjectStateMap,
} from "../world";
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
import { PackFrameResolver, type FrameRef } from "./pack-textures";
import { playerColor } from "./palette";
import { WORLD_EVENT, type WorldSceneEvent } from "./world-events";

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
  /**
   * Dibuja el diálogo de inspección dentro de Phaser (por defecto `true`). En la
   * integración React, ponerlo a `false` y escuchar `world:event` para pintarlo
   * en el DOM.
   */
  dialogOverlay?: boolean;
  /**
   * Modo dirigido por motor: la escena **no resuelve** la interacción (no
   * inspecciona ni reparte contenedores ni emite `dialog`). Al seleccionar un
   * objeto emite la intención `interact { objectId }`, y al soltar un item,
   * `use-item { itemId, objectId }`; la capa React resuelve con `RoomSession`.
   * Sin él (por defecto) la escena mantiene el modo autocontenido de las
   * previsualizaciones del mundo (ticket 1.3).
   */
  intentOnly?: boolean;
  /**
   * Si es `false`, el avatar no se mueve ni interactúa (p. ej. mientras la
   * intro bloquea el juego, specs/04 §4). Por defecto `true`.
   */
  inputEnabled?: boolean;
  /** Id del jugador local, para el reparto de inventario (`distribution`). */
  localPlayerId?: string;
}

/** Vista de un objeto en la escena: sprite, brillo de hover y profundidad. */
interface ObjectView {
  object: RuntimeObject;
  sprite: Phaser.GameObjects.Sprite;
  glow: Phaser.GameObjects.Ellipse;
  baseScaleX: number;
  baseScaleY: number;
}

const DEPTH = {
  ground: 0,
  water: 1,
  tileSub: 10,
  decorationSub: 20,
  objectGlowSub: 29,
  objectSub: 30,
  ambient: 9000,
  halo: 9001,
  dialog: 9500,
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
  private readonly dialogOverlayEnabled: boolean;
  private readonly intentOnly: boolean;
  private localInputEnabled: boolean;
  private readonly localPlayerId: string;
  private readonly manifest: PackManifest;

  private activeRoomId: string;
  private roomObjects: Phaser.GameObjects.GameObject[] = [];
  /** Antorchas y agua: se repintan cuando cambia un objeto del que dependen. */
  private reactiveObjects: Phaser.GameObjects.GameObject[] = [];
  private reactiveIds = new Set<string>();
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
  /** Objeto al que el avatar camina para abrir su menú al llegar (clic). */
  private pendingObjectId?: string;

  private objectState: ObjectStateMap = {};
  private containers: ContainerStateMap = {};
  private objectViews = new Map<string, ObjectView>();
  private hoveredObjectId?: string;
  private dialogBox?: Phaser.GameObjects.Container;
  private dialogHideAt = 0;

  constructor(options: RoomSceneOptions) {
    super("room-preview");
    this.model = options.model;
    this.showLabels = options.showLabels ?? false;
    this.pack = options.pack;
    this.avatarEnabled = options.avatar ?? true;
    this.dialogOverlayEnabled = options.dialogOverlay ?? true;
    this.intentOnly = options.intentOnly ?? false;
    this.localInputEnabled = options.inputEnabled ?? true;
    this.localPlayerId = options.localPlayerId ?? "p0";
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

    this.objectState = createObjectStateMap(this.model);
    this.containers = createContainerStateMap(this.model);
    this.setupInput();
    this.buildRoom();
    this.cameras.main.fadeIn(200, 11, 17, 32);
  }

  update(time: number, delta: number): void {
    if (this.dialogBox && time > this.dialogHideAt) {
      this.hideDialog();
    }
    if (!this.built || this.transitioning || !this.avatar) {
      return;
    }
    if (!this.localInputEnabled) {
      this.avatar.update(delta, null);
      return;
    }
    this.avatar.update(delta, this.readMove());
    this.resolvePendingInteraction();
    this.checkDoor(time);
  }

  /**
   * Habilita o deshabilita el control del jugador (movimiento + interacción).
   * La intro lo desactiva hasta cerrarse (specs/04 §4); el HUD del inventario
   * también lo desactiva para que los clics no se cuelen al mundo.
   */
  setInputEnabled(enabled: boolean): void {
    if (this.localInputEnabled === enabled) {
      return;
    }
    this.localInputEnabled = enabled;
    if (!enabled) {
      this.clickTarget = undefined;
      this.pendingObjectId = undefined;
      this.input.setDefaultCursor("default");
    }
  }

  get inputEnabled(): boolean {
    return this.localInputEnabled;
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
    this.pendingObjectId = undefined;
    this.hoveredObjectId = undefined;
    this.input.setDefaultCursor("default");
    this.objectViews.clear();
    this.hideDialog();
    for (const object of this.roomObjects) {
      object.destroy();
    }
    this.roomObjects = [];
    this.clearReactive();
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

  /**
   * Escala un sprite al tamaño **lógico** (el del manifiesto), con
   * independencia de la resolución del pack (1× o 2×). Sin esto, un pack a 2×
   * se pintaría al doble. Devuelve el objeto para encadenar.
   */
  private fitToLogicalSize<
    T extends Phaser.GameObjects.Components.Transform & {
      setScale(x?: number, y?: number): T;
    },
  >(sprite: T, ref: FrameRef, size: { width: number; height: number }): T {
    const scale = this.resolver.displayScaleFor(ref, size);
    return sprite.setScale(scale.x, scale.y);
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
        const image = this.add.image(x, y, ref.key, ref.frame).setOrigin(0.5, 0.5);
        this.fitToLogicalSize(image, ref, FLOOR_TILE_SIZE);
        this.track(image.setDepth(DEPTH.ground));
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
          const image = this.add.image(anchor.x, anchor.y, ref.key, ref.frame).setOrigin(0.5, 1);
          this.fitToLogicalSize(image, ref, WALL_TILE_SIZE);
          this.track(image.setDepth(isoDepth(tx, ty, DEPTH.tileSub) + 1));
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

      const decorationImage = this.add
        .image(anchor.x, anchor.y, ref.key, ref.frame)
        .setOrigin(0.5, 1);
      this.fitToLogicalSize(decorationImage, ref, SPRITE_SIZE);
      this.track(decorationImage.setDepth(depth));

      if (this.showLabels) {
        this.label(decoration.sprite, anchor.x, anchor.y - SPRITE_SIZE.height, depth);
      }
    }
  }

  private drawObjects(room: RuntimeSubRoom): void {
    for (const object of room.objects) {
      const state = currentObjectState(this.objectState, object);
      const frame = resolveSpriteFrame(this.manifest, resolveObjectStateSprite(object, state));
      const ref = this.resolver.resolve(frame, SPRITE_SIZE);
      const anchor = tileAnchor(object.position.x, object.position.y);
      const depth = isoDepth(object.position.x, object.position.y, DEPTH.objectSub) + 1;

      const glow = this.track(
        this.add
          .ellipse(
            anchor.x,
            anchor.y - SPRITE_SIZE.height * 0.35,
            SPRITE_SIZE.width * 0.72,
            SPRITE_SIZE.height * 0.22,
            0xffe08a,
            0,
          )
          .setDepth(isoDepth(object.position.x, object.position.y, DEPTH.objectGlowSub) + 1)
          .setBlendMode(Phaser.BlendModes.ADD),
      );

      const sprite = this.add.sprite(anchor.x, anchor.y, ref.key, ref.frame).setOrigin(0.5, 1);
      this.fitToLogicalSize(sprite, ref, SPRITE_SIZE);
      this.track(sprite.setDepth(depth));

      const view: ObjectView = {
        object,
        sprite,
        glow,
        baseScaleX: sprite.scaleX,
        baseScaleY: sprite.scaleY,
      };
      this.objectViews.set(object.id, view);

      if (object.interactable) {
        this.wireInteraction(view);
      }

      if (this.showLabels) {
        const suffix = object.lockedBy ? " (bloqueado)" : "";
        this.label(`${object.id}${suffix}`, anchor.x, anchor.y - SPRITE_SIZE.height, depth);
      }
    }
  }

  /** Habilita brillo de pista, cursor y clic sobre un objeto interactuable. */
  private wireInteraction(view: ObjectView): void {
    const { sprite, object } = view;
    sprite.setInteractive({ useHandCursor: true });
    sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.setHover(object.id));
    sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this.clearHover(object.id));
    sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      if (!this.localInputEnabled) {
        return;
      }
      this.walkToObject(object.id);
    });
  }

  /**
   * Hace que el avatar camine hacia el objeto y, al llegar (dentro del radio de
   * interacción), abra su menú/interacción. Nunca interactúa a distancia
   * (specs/04 §4).
   */
  private walkToObject(objectId: string): void {
    const object = this.model.objectsById[objectId];
    if (!object || !object.interactable || !this.avatar) {
      return;
    }
    const target = approachCell(object.position, this.avatar.gridCell, (x, y) =>
      this.collision.isWalkable(x, y),
    );
    if (!target) {
      this.inspectObjectById(objectId);
      return;
    }
    this.pendingObjectId = objectId;
    this.clickTarget = target;
  }

  /** Si el avatar ya alcanzó el objeto pendiente, abre su menú/interacción. */
  private resolvePendingInteraction(): void {
    const objectId = this.pendingObjectId;
    if (!objectId || !this.avatar) {
      return;
    }
    const object = this.model.objectsById[objectId];
    if (!object) {
      this.pendingObjectId = undefined;
      return;
    }
    const cell = this.avatar.gridCell;
    const distance = Math.hypot(object.position.x - cell.x, object.position.y - cell.y);
    if (distance <= 1.75) {
      this.pendingObjectId = undefined;
      this.clickTarget = undefined;
      this.inspectObjectById(objectId);
    }
  }

  /** Brillo/pista al pasar el cursor sobre un objeto interactuable. */
  private setHover(objectId: string): void {
    if (this.hoveredObjectId === objectId) {
      return;
    }
    if (this.hoveredObjectId) {
      this.clearHover(this.hoveredObjectId);
    }

    const view = this.objectViews.get(objectId);
    if (!view) {
      return;
    }
    this.hoveredObjectId = objectId;
    this.input.setDefaultCursor("pointer");

    view.glow.setAlpha(0.55);
    this.tweens.add({
      targets: view.glow,
      alpha: { from: 0.3, to: 0.7 },
      duration: 620,
      yoyo: true,
      repeat: -1,
    });
    this.tweens.add({
      targets: view.sprite,
      scaleX: view.baseScaleX * 1.06,
      scaleY: view.baseScaleY * 1.06,
      duration: 140,
    });
  }

  private clearHover(objectId: string): void {
    if (this.hoveredObjectId !== objectId) {
      return;
    }
    this.hoveredObjectId = undefined;
    this.input.setDefaultCursor("default");

    const view = this.objectViews.get(objectId);
    if (!view) {
      return;
    }
    this.tweens.killTweensOf(view.glow);
    view.glow.setAlpha(0);
    this.tweens.add({
      targets: view.sprite,
      scaleX: view.baseScaleX,
      scaleY: view.baseScaleY,
      duration: 140,
    });
  }

  /**
   * Cambia el estado de un objeto del mundo (lo consumirá el motor de reglas de
   * 1.4). Actualiza el sprite/animación y emite `world:event`.
   */
  setObjectState(objectId: string, state: string): void {
    const object = this.model.objectsById[objectId];
    if (!object) {
      throw new Error(`RoomScene: el objeto "${objectId}" no existe en el modelo.`);
    }
    const next = applyObjectState(this.objectState, object, state);
    if (next === this.objectState) {
      return;
    }
    this.objectState = next;
    this.syncObjectView(object);
    if (this.built && this.reactiveIds.has(objectId)) {
      const room = this.model.subroomsById[this.activeRoomId];
      if (room) this.drawReactive(room);
    }
    this.emit({ type: "state", objectId, state });
  }

  /** Estado actual de un objeto (para consumidores externos). */
  objectStateOf(objectId: string): string | undefined {
    const object = this.model.objectsById[objectId];
    return object ? currentObjectState(this.objectState, object) : undefined;
  }

  private syncObjectView(object: RuntimeObject): void {
    const view = this.objectViews.get(object.id);
    if (!view) {
      return;
    }
    const state = currentObjectState(this.objectState, object);
    const frame = resolveSpriteFrame(this.manifest, resolveObjectStateSprite(object, state));
    const ref = this.resolver.resolve(frame, SPRITE_SIZE);
    view.sprite.setTexture(ref.key, ref.frame);
    const scale = this.resolver.displayScaleFor(ref, SPRITE_SIZE);
    view.sprite.setScale(scale.x, scale.y);
    view.baseScaleX = scale.x;
    view.baseScaleY = scale.y;

    const animation = resolveObjectStateAnimation(object, state);
    if (animation) {
      this.playTransition(view.sprite, animation);
    }
  }

  private playTransition(sprite: Phaser.GameObjects.Sprite, animation: string): void {
    if (this.ensureObjectAnimation(animation)) {
      sprite.play(animation);
      return;
    }

    const baseX = sprite.x;
    const baseY = sprite.y;
    switch (animation) {
      case "shake":
        this.tweens.add({
          targets: sprite,
          x: baseX + 4,
          duration: 60,
          yoyo: true,
          repeat: 5,
          onComplete: () => sprite.setX(baseX),
        });
        break;
      case "slide_up":
        sprite.setY(baseY + 12);
        this.tweens.add({ targets: sprite, y: baseY, duration: 220, ease: "Cubic.Out" });
        break;
      case "pulse":
        this.tweens.add({
          targets: sprite,
          scaleX: sprite.scaleX * 1.12,
          scaleY: sprite.scaleY * 1.12,
          duration: 180,
          yoyo: true,
        });
        break;
      case "fade_in":
        sprite.setAlpha(0);
        this.tweens.add({ targets: sprite, alpha: 1, duration: 260 });
        break;
      default:
        break;
    }
  }

  /** Registra una animación de objeto declarada por el pack (si no existe ya). */
  private ensureObjectAnimation(key: string): boolean {
    if (this.anims.exists(key)) {
      return true;
    }
    const declared = this.manifest.anims.find((anim) => anim.key === key);
    if (!declared) {
      return false;
    }
    this.anims.create({
      key,
      frames: declared.frames.map((frame) => {
        const ref = this.resolver.resolve(frame, SPRITE_SIZE);
        return { key: ref.key, frame: ref.frame };
      }),
      frameRate: declared.frameRate,
      repeat: declared.repeat,
    });
    return true;
  }

  /** Inspecciona un objeto: diálogo, reparto de inventario y panel asociado. */
  inspectObjectById(objectId: string): void {
    const object = this.model.objectsById[objectId];
    if (!object || !object.interactable) {
      return;
    }

    if (this.intentOnly) {
      this.emit({ type: "interact", objectId });
      return;
    }

    const result = inspectObject(this.model, objectId, {
      locale: this.model.locale,
      containers: this.containers,
    });
    if (!result) {
      return;
    }

    const { text, collected } = this.buildInspectText(object, result);
    if (collected.length > 0) {
      this.emit({ type: "collect", objectId, playerId: this.localPlayerId, items: collected });
    }
    if (result.panelPuzzleId) {
      this.emit({ type: "open-panel", objectId, puzzleId: result.panelPuzzleId });
    }
    if (text) {
      this.showDialog(text);
      this.emit({
        type: "dialog",
        objectId,
        ...(result.dialogId ? { dialogId: result.dialogId } : {}),
        text,
        ...(result.panelPuzzleId ? { panelPuzzleId: result.panelPuzzleId } : {}),
        conditioned: result.conditioned,
      });
    }
  }

  private buildInspectText(
    object: RuntimeObject,
    result: ReturnType<typeof inspectObject>,
  ): { text?: string; collected: string[] } {
    const parts: string[] = [];
    if (result?.dialog?.text) {
      parts.push(result.dialog.text);
    }

    let collected: string[] = [];
    if (object.inventory && object.inventory.length > 0) {
      const collect = collectContainer(this.containers, object, { openerId: this.localPlayerId });
      if (collect.alreadyOpen) {
        const remaining = containerContents(this.containers, object.id);
        parts.push(
          remaining.length > 0
            ? `Queda dentro: ${remaining.map((id) => this.itemName(id)).join(", ")}.`
            : "Está vacío.",
        );
      } else {
        this.containers = collect.map;
        collected = collect.grants[this.localPlayerId] ?? [];
        if (collected.length > 0) {
          parts.push(`Recibes: ${collected.map((id) => this.itemName(id)).join(", ")}.`);
        }
      }
    }

    if (parts.length === 0 && result?.panelPuzzleId) {
      parts.push(`Abre el panel: ${result.panelPuzzleId}.`);
    }

    return { ...(parts.length > 0 ? { text: parts.join(" ") } : {}), collected };
  }

  private itemName(itemId: string): string {
    return this.model.itemsById[itemId]?.name ?? itemId;
  }

  /** Interactúa con el objeto interactuable más cercano al avatar (tecla Espacio). */
  private interactNearest(): void {
    if (!this.localInputEnabled || !this.avatar) {
      return;
    }
    const nearest = this.findInteractableNear(this.avatar.gridCell);
    if (nearest) {
      this.inspectObjectById(nearest);
    }
  }

  /**
   * Suelta un item del inventario sobre el objeto del mundo bajo el puntero
   * (drag&drop). Convierte coordenadas de pantalla a celda isométrica, busca el
   * objeto interactuable más cercano y emite `use-item { itemId, objectId }`.
   *
   * Devuelve el `objectId` destino, o `undefined` si el puntero no cae sobre
   * ningún objeto interactuable.
   */
  dropItemAt(itemId: string, screenX: number, screenY: number): string | undefined {
    const rect = this.game.canvas.getBoundingClientRect();
    const world = this.cameras.main.getWorldPoint(screenX - rect.left, screenY - rect.top);
    const tile = worldToTile(world.x, world.y);
    const target = this.findInteractableNear({ x: tile.tx, y: tile.ty });
    if (!target) {
      return undefined;
    }
    this.emit({ type: "use-item", itemId, objectId: target });
    return target;
  }

  /**
   * Id del objeto interactuable más cercano a una celda dentro del radio dado.
   * Delegación pura (`nearestInteractable`) con desempate estable: nunca salta
   * a otro objeto a igual distancia.
   */
  private findInteractableNear(cell: { x: number; y: number }, radius = 1.75): string | undefined {
    const room = this.model.subroomsById[this.activeRoomId];
    if (!room) {
      return undefined;
    }
    return nearestInteractable(room.objects, cell, { radius })?.id;
  }

  private showDialog(text: string): void {
    if (!this.dialogOverlayEnabled) {
      return;
    }
    this.hideDialog();

    const width = Math.min(this.scale.width - 32, 660);
    const height = 92;
    const x = this.scale.width / 2;
    const y = this.scale.height - height / 2 - 20;

    const background = this.add
      .rectangle(0, 0, width, height, 0x0b1120, 0.9)
      .setOrigin(0.5)
      .setStrokeStyle(1, 0xffe08a, 0.5);
    const label = this.add
      .text(0, -6, text, {
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: "14px",
        color: "#f8fafc",
        align: "center",
        wordWrap: { width: width - 36 },
      })
      .setOrigin(0.5);
    const hint = this.add
      .text(0, height / 2 - 14, "Espacio / clic para inspeccionar", {
        fontFamily: "ui-monospace, monospace",
        fontSize: "10px",
        color: "#94a3b8",
      })
      .setOrigin(0.5);

    this.dialogBox = this.add
      .container(x, y, [background, label, hint])
      .setScrollFactor(0)
      .setDepth(DEPTH.dialog);
    this.dialogHideAt = this.time.now + 6000;
  }

  private hideDialog(): void {
    this.dialogBox?.destroy(true);
    this.dialogBox = undefined;
    this.dialogHideAt = 0;
  }

  private emit(event: WorldSceneEvent): void {
    this.events.emit(WORLD_EVENT, event);
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

    this.drawReactive(room);
  }

  /**
   * Capa reactiva (specs/04 §3.4): antorchas encendidas/apagadas según el
   * objeto que las gobierna (brasero, `mesa-catas`) y el canal de agua de los
   * puzzles `pipes`, que corre animado hacia el altar cuando fluye.
   */
  private drawReactive(room: RuntimeSubRoom): void {
    this.clearReactive();
    this.reactiveIds = reactiveObjectIds(this.model, room.id);

    for (const channel of resolveWaterChannels(this.model, room.id, this.objectState)) {
      channel.cells.forEach((cell, index) => {
        const { x, y } = tileToWorld(cell.x, cell.y);
        const bed = this.reactive(this.add.graphics());
        bed.setDepth(DEPTH.water);
        bed.fillStyle(channel.flowing ? 0x2f7fd8 : 0x3b3326, channel.flowing ? 0.85 : 0.9);
        fillDiamond(bed, x, y, ISO_TILE_WIDTH * 0.42, ISO_TILE_HEIGHT * 0.42);
        if (!channel.flowing) {
          return;
        }
        // El agua avanza celda a celda desde la entrada: brillo que recorre el canal.
        const shine = this.reactive(this.add.graphics());
        shine.setDepth(DEPTH.water).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        shine.fillStyle(0x9ad7ff, 0.9);
        fillDiamond(shine, x, y, ISO_TILE_WIDTH * 0.28, ISO_TILE_HEIGHT * 0.28);
        this.tweens.add({
          targets: shine,
          alpha: { from: 0, to: 0.8 },
          duration: 420,
          delay: index * 90,
          yoyo: true,
          repeat: -1,
          repeatDelay: channel.cells.length * 90,
        });
      });
    }

    for (const torch of resolveTorchLights(this.model, room.id, this.objectState)) {
      const { x, y } = tileToWorld(torch.x, torch.y);
      const halo = this.reactive(this.add.graphics());
      halo.setDepth(DEPTH.halo).setBlendMode(Phaser.BlendModes.ADD);
      if (!torch.lit) {
        // Antorcha apagada: solo un punto de brasa tenue.
        halo.fillStyle(0x7a4a22, 0.25);
        halo.fillCircle(x, y, 8);
        continue;
      }
      for (let ring = 4; ring >= 1; ring -= 1) {
        halo.fillStyle(0xffd27f, 0.05);
        halo.fillCircle(x, y, ring * 42);
      }
      this.tweens.add({
        targets: halo,
        alpha: { from: 0.85, to: 1 },
        duration: 380,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  private reactive<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.reactiveObjects.push(object);
    return object;
  }

  private clearReactive(): void {
    for (const object of this.reactiveObjects) {
      this.tweens.killTweensOf(object);
      object.destroy();
    }
    this.reactiveObjects = [];
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
    keyboard.on("keydown-SPACE", () => {
      if (!this.localInputEnabled) {
        return;
      }
      this.avatar?.interact();
      this.interactNearest();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      keyboard.removeAllListeners("keydown-SPACE");
    });
  }

  /** Clic: si el cursor está sobre un objeto interactuable no mueve; si no, camina. */
  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.transitioning || !this.localInputEnabled) {
      return;
    }
    if (this.hoveredObjectId) {
      return;
    }
    if (!this.avatar) {
      return;
    }
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tile = worldToTile(world.x, world.y);
    if (this.collision.isWalkable(tile.tx, tile.ty)) {
      this.pendingObjectId = undefined;
      this.clickTarget = { x: tile.tx, y: tile.ty };
    }
  }

  private readMove(): { x: number; y: number } | null {
    const keyboardMove = this.readKeyboardMove();
    if (keyboardMove) {
      this.clickTarget = undefined;
      this.pendingObjectId = undefined;
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
      // Dirigida por motor: solo se cruza una puerta que el servidor ha abierto.
      if (this.intentOnly && currentObjectState(this.objectState, door) !== "open") {
        return;
      }
      this.doorCooldownUntil = time + 600;
      const fromRoomId = this.activeRoomId;
      this.setRoom(door.leadsTo);
      this.emit({ type: "enter-room", roomId: door.leadsTo, fromRoomId });
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

/** Rombo isométrico centrado en `(x, y)` con semiejes `halfW`/`halfH`. */
function fillDiamond(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  halfW: number,
  halfH: number,
): void {
  graphics.beginPath();
  graphics.moveTo(x, y - halfH);
  graphics.lineTo(x + halfW, y);
  graphics.lineTo(x, y + halfH);
  graphics.lineTo(x - halfW, y);
  graphics.closePath();
  graphics.fillPath();
}

function parseColor(color: string): number {
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  const value = Number.parseInt(normalized, 16);
  return Number.isNaN(value) ? 0x000000 : value;
}
