import Phaser from "phaser";
import type { RuntimeModel, RuntimeObject, RuntimeSubRoom } from "../loader";
import {
  buildCollisionGrid,
  buildPlaceholderManifest,
  PLACEHOLDER_CHARACTER_ID,
  resolveSpriteFrame,
  resolveTileFrame,
  spriteOrigin,
  spriteSize,
  tileOrigin,
  tileSize,
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
import { EDIT_EVENT, type EditCell, type EditSceneEvent } from "../edit";
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
  /**
   * Personaje jugable del avatar local (`manifest.avatars[].id`, o el de
   * reserva). Por defecto el primero de `manifest.avatars`, o el personaje de
   * placeholder si el pack no declara ninguno (A1/B4).
   */
  localCharacterId?: string;
  /**
   * `play` (por defecto) o `edit` (specs/09 §1: el editor ES el runtime). En
   * edición no hay avatar, diálogos ni puertas: se pinta la rejilla, los
   * spawns y los ids, todos los objetos son seleccionables y el puntero se
   * emite como `edit:event` (celda + objeto debajo) para la capa de comandos.
   */
  mode?: "play" | "edit";
  /**
   * Emite `avatar-move` con la posición del avatar local mientras se mueve
   * (como mucho cada `AVATAR_MOVE_EMIT_MS`). Lo activa el cliente de red.
   */
  emitAvatarMoves?: boolean;
}

/** Otro jugador de la partida, tal como lo sincroniza el servidor (fase 2). */
export interface ScenePlayer {
  id: string;
  name: string;
  roomId: string;
  x: number;
  y: number;
  /** `#rrggbb`. */
  tint: string;
  /** Personaje jugable (`manifest.avatars[].id`, o el de reserva). */
  characterId: string;
  connected: boolean;
}

/** Cadencia máxima del evento `avatar-move` (≈10 msg/s, specs/11 §9). */
export const AVATAR_MOVE_EMIT_MS = 100;

/** Avatar de otro jugador: se interpola hacia la última posición del servidor. */
interface RemoteAvatar {
  controller: AvatarController;
  label: Phaser.GameObjects.Text;
  target: { x: number; y: number };
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
  /** Solo en modo edición. */
  editGrid: 2,
  editCursor: 9100,
} as const;

const FLOOR_TILE_SIZE = { width: ISO_TILE_WIDTH, height: ISO_TILE_HEIGHT };
/** Lienzo de reserva sin manifiesto (packs antiguos/placeholder): muro 2,4 m. */
const WALL_TILE_SIZE = { width: 64, height: 136 };
const SPRITE_SIZE = { width: 64, height: 96 };
const SPAWN_MARKER_DEPTH_SUB = 90;

/**
 * Alpha de los muros del frente (specs/04 §1: "las paredes... que quedan por
 * delante... se desvanecen"). Con la guarda de "sin elevaciones/multinivel"
 * (ADR-001), el frente de cada sala son siempre los muros de la fila/columna
 * mayor (los más próximos a la cámara): su cara hacia la sala no la ve la
 * cámara, así que se atenúan de forma fija (no depende de la posición del
 * avatar) para dejar ver el interior y los objetos colgados de ellos.
 */
const WALL_FRONT_ALPHA = 0.32;

/**
 * Escena del runtime de producto: pinta un `RuntimeSubRoom` con el
 * tilemap isométrico real (tiles + muros del pack, o placeholders automáticos),
 * depth-sort con sprites, colisiones por celda, avatar animado, cámara y
 * transición de sala (specs/04 §1, specs/26).
 *
 * El loader puro de 1.1 (`RuntimeModel`) es la única fuente del mundo; el pack
 * solo aporta frames. Sin pack, cada frame se sustituye por una textura de
 * color con su nombre, así que la sala se ve sin arte real.
 *
 * Con `mode: 'edit'` es el lienzo del editor (specs/09 §1): mismo render, sin
 * avatar ni lógica de juego, y el modelo se sustituye (`setModel`) cada vez que
 * cambia el doc Yjs.
 */
export class RoomScene extends Phaser.Scene {
  private model: RuntimeModel;
  readonly mode: "play" | "edit";
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

  // Estado del modo edición (lo decide la capa de comandos, no la escena).
  private selectedObjectId?: string;
  private dragPreview?: { objectId: string; cell: EditCell };
  private hoverCell?: EditCell;
  private editCursor?: Phaser.GameObjects.Graphics;
  private editSelection?: Phaser.GameObjects.Graphics;
  // — Multijugador (fase 2) —
  private readonly emitAvatarMoves: boolean;
  private lastEmittedMove?: { roomId: string; x: number; y: number; at: number };
  /** Posición autoritativa pendiente de aplicar al avatar local (tras reconstruir la sala). */
  private pendingAvatarCell?: { x: number; y: number };
  private localTint?: number;
  private localCharacterId: string;
  private players: ScenePlayer[] = [];
  private readonly remoteAvatars = new Map<string, RemoteAvatar>();
  /** Estados que llegaron (del servidor) antes de que Phaser creara la escena. */
  private readonly earlyObjectStates = new Map<string, string>();

  constructor(options: RoomSceneOptions) {
    super("room-preview");
    this.model = options.model;
    this.mode = options.mode ?? "play";
    const editing = this.mode === "edit";
    this.showLabels = options.showLabels ?? editing;
    this.pack = options.pack;
    this.avatarEnabled = editing ? false : (options.avatar ?? true);
    this.dialogOverlayEnabled = editing ? false : (options.dialogOverlay ?? true);
    this.intentOnly = options.intentOnly ?? false;
    this.localInputEnabled = options.inputEnabled ?? true;
    this.localPlayerId = options.localPlayerId ?? "p0";
    this.emitAvatarMoves = options.emitAvatarMoves ?? false;
    this.manifest = options.pack?.manifest ?? buildPlaceholderManifest(options.model);
    this.localCharacterId =
      options.localCharacterId ?? this.manifest.avatars?.[0]?.id ?? PLACEHOLDER_CHARACTER_ID;

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
    for (const [objectId, state] of this.earlyObjectStates) {
      const object = this.model.objectsById[objectId];
      if (!object?.states.includes(state)) continue; // estado no declarado: se ignora
      this.objectState = applyObjectState(this.objectState, object, state);
    }
    this.earlyObjectStates.clear();
    this.containers = createContainerStateMap(this.model);
    this.setupInput();
    this.buildRoom();
    this.cameras.main.fadeIn(200, 11, 17, 32);
  }

  update(time: number, delta: number): void {
    if (this.dialogBox && time > this.dialogHideAt) {
      this.hideDialog();
    }
    if (!this.built || this.transitioning) {
      return;
    }
    this.updateRemoteAvatars(delta);
    if (!this.avatar) {
      return;
    }
    if (!this.localInputEnabled) {
      this.avatar.update(delta, null);
      return;
    }
    this.avatar.update(delta, this.readMove());
    this.emitAvatarMove(time);
    this.resolvePendingInteraction();
    this.checkDoor(time);
  }

  /**
   * Recoloca el avatar local en la posición autoritativa del servidor (spawn,
   * cruce de sala o movimiento rechazado). Si la sala se está reconstruyendo,
   * se aplica al crear el avatar.
   */
  placeAvatar(x: number, y: number): void {
    this.clickTarget = undefined;
    this.pendingObjectId = undefined;
    if (this.avatar && !this.transitioning) {
      this.avatar.setCell(x, y);
      this.lastEmittedMove = { roomId: this.activeRoomId, x, y, at: this.time?.now ?? 0 };
    } else {
      this.pendingAvatarCell = { x, y };
    }
  }

  /** Posición actual del avatar local (celdas), si existe. */
  get avatarCell(): { x: number; y: number } | undefined {
    return this.avatar?.cellPosition;
  }

  /** Color del anillo del avatar local (color asignado por el servidor). */
  setLocalTint(tint: number): void {
    this.localTint = tint;
    this.avatar?.setTint(tint);
  }

  /** Personaje del avatar local (asignado o confirmado por el servidor). */
  setLocalCharacter(characterId: string): void {
    if (this.localCharacterId === characterId) {
      return;
    }
    this.localCharacterId = characterId;
    if (this.built && !this.transitioning && this.avatarEnabled) {
      const cell = this.avatar?.cellPosition;
      this.avatar?.destroy();
      this.avatar = this.createAvatarController(cell ?? { x: 0, y: 0 });
    }
  }

  /**
   * Jugadores de la partida (sin el local). Se pintan los de la sala visible y
   * se interpolan hacia su última posición sincronizada.
   */
  setPlayers(players: readonly ScenePlayer[]): void {
    this.players = players.map((player) => ({ ...player }));
    if (!this.built || this.transitioning) {
      return;
    }
    this.syncRemoteAvatars();
  }

  private syncRemoteAvatars(): void {
    const visible = new Map(
      this.players
        .filter((player) => player.roomId === this.activeRoomId && player.connected)
        .map((player) => [player.id, player]),
    );
    for (const [id, remote] of this.remoteAvatars) {
      if (!visible.has(id)) {
        remote.controller.destroy();
        this.remoteAvatars.delete(id);
      }
    }
    for (const player of visible.values()) {
      const existing = this.remoteAvatars.get(player.id);
      if (existing) {
        existing.target = { x: player.x, y: player.y };
        existing.label.setText(player.name);
        continue;
      }
      const controller = new AvatarController({
        scene: this,
        resolver: this.resolver,
        manifest: this.manifest,
        collision: this.collision,
        start: { x: player.x, y: player.y },
        characterId: player.characterId || PLACEHOLDER_CHARACTER_ID,
        tint: Phaser.Display.Color.HexStringToColor(player.tint).color,
      });
      const label = this.add
        .text(0, -100, player.name, {
          fontFamily: "system-ui, sans-serif",
          fontSize: "13px",
          color: "#f8fafc",
          backgroundColor: "rgba(2, 6, 23, 0.65)",
          padding: { x: 4, y: 1 },
        })
        .setOrigin(0.5, 1);
      controller.container.add(label);
      this.remoteAvatars.set(player.id, {
        controller,
        label,
        target: { x: player.x, y: player.y },
      });
    }
  }

  private updateRemoteAvatars(delta: number): void {
    for (const remote of this.remoteAvatars.values()) {
      remote.controller.glideToward(remote.target, delta);
    }
  }

  private clearRemoteAvatars(): void {
    for (const remote of this.remoteAvatars.values()) {
      remote.controller.destroy();
    }
    this.remoteAvatars.clear();
  }

  /** Emite `avatar-move` si el avatar local se desplazó (throttle ≈10/s). */
  private emitAvatarMove(time: number): void {
    if (!this.emitAvatarMoves || !this.avatar) {
      return;
    }
    const cell = this.avatar.cellPosition;
    const last = this.lastEmittedMove;
    const moved =
      !last ||
      last.roomId !== this.activeRoomId ||
      Math.hypot(cell.x - last.x, cell.y - last.y) > 0.05;
    if (!moved || (last && time - last.at < AVATAR_MOVE_EMIT_MS)) {
      return;
    }
    this.lastEmittedMove = { roomId: this.activeRoomId, x: cell.x, y: cell.y, at: time };
    this.emit({ type: "avatar-move", roomId: this.activeRoomId, x: cell.x, y: cell.y });
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
    if (this.showLabels || this.mode === "edit") {
      this.drawSpawns(room);
    }
    this.drawLighting(room);
    if (this.mode === "edit") {
      this.drawEditOverlay(room);
    }
    this.applyCamera(room);
    this.buildAvatar(room);

    this.built = true;
    this.syncRemoteAvatars();
  }

  private clearRoom(): void {
    this.avatar?.destroy();
    this.avatar = undefined;
    this.clearRemoteAvatars();
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
    this.editCursor = undefined;
    this.editSelection = undefined;
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

  /**
   * Tamaño lógico (a 1×) para pintar un frame: el declarado por el manifiesto
   * (`manifest.tiles[tileId].size` / `manifest.sprites[sprite].size`) si lo
   * hay; si no, el tamaño real del frame en el atlas dividido por
   * `projection.scale` (specs/26 §3.2); si tampoco hay atlas (placeholder),
   * el tamaño de reserva.
   */
  private resolveDisplaySize(
    explicit: readonly [number, number] | undefined,
    ref: FrameRef,
    fallback: { width: number; height: number },
  ): { width: number; height: number } {
    if (explicit) {
      return { width: explicit[0], height: explicit[1] };
    }
    if (ref.size) {
      const scale = this.manifest.projection.scale || 1;
      return { width: ref.size.width / scale, height: ref.size.height / scale };
    }
    return fallback;
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

  /**
   * Muros y demás capas: sprites con overhang, pivote y tamaño por frame
   * (`manifest.tiles[tileId]`, specs/26 §3.2). Un muro es "de frente" (los más
   * próximos a la cámara, su cara hacia la sala no la ve) cuando la celda
   * vecina hacia el interior (`tx-1` o `ty-1`) está libre de muro: es la
   * última barrera antes del interior transitable, así que se desvanece
   * (specs/04 §1) para dejar ver el interior y lo que cuelga de ella (puerta,
   * reja, mirillas…). No basta con "última fila/columna de la rejilla": una
   * sala puede tener un muro de refuerzo detrás del que lleva el hueco (p. ej.
   * la bodega, fila 10 con el arco/reja + fila 11 de cierre) — ese muro
   * trasero queda oculto tras el de frente y no hace falta desvanecerlo.
   */
  private drawWalls(room: RuntimeSubRoom): void {
    for (const layer of room.layers) {
      if (layer.name === "ground") {
        continue;
      }
      const isWallAt = (tx: number, ty: number): boolean =>
        tx >= 0 &&
        ty >= 0 &&
        tx < room.width &&
        ty < room.height &&
        (layer.tiles[ty * room.width + tx] ?? 0) !== 0;

      for (let ty = 0; ty < room.height; ty += 1) {
        for (let tx = 0; tx < room.width; tx += 1) {
          const tileId = layer.tiles[ty * room.width + tx] ?? 0;
          if (tileId === 0) {
            continue;
          }
          const frame = resolveTileFrame(this.manifest, tileId);
          const explicitSize = tileSize(this.manifest, tileId);
          const ref = this.resolver.resolve(
            frame,
            explicitSize ? { width: explicitSize[0], height: explicitSize[1] } : WALL_TILE_SIZE,
          );
          const size = this.resolveDisplaySize(explicitSize, ref, WALL_TILE_SIZE);
          const origin = tileOrigin(this.manifest, tileId);
          const anchor = tileAnchor(tx, ty);
          const isFront =
            (tx > 0 && !isWallAt(tx - 1, ty)) || (ty > 0 && !isWallAt(tx, ty - 1));
          const image = this.add
            .image(anchor.x, anchor.y, ref.key, ref.frame)
            .setOrigin(origin[0], origin[1])
            .setAlpha(isFront ? WALL_FRONT_ALPHA : 1);
          this.fitToLogicalSize(image, ref, size);
          this.track(image.setDepth(isoDepth(tx, ty, DEPTH.tileSub) + 1));
        }
      }
    }
  }

  private drawDecorations(room: RuntimeSubRoom): void {
    for (const decoration of room.decorations) {
      const frame = resolveSpriteFrame(this.manifest, decoration.sprite);
      const explicitSize = spriteSize(this.manifest, decoration.sprite);
      const ref = this.resolver.resolve(
        frame,
        explicitSize ? { width: explicitSize[0], height: explicitSize[1] } : SPRITE_SIZE,
      );
      const size = this.resolveDisplaySize(explicitSize, ref, SPRITE_SIZE);
      const origin = spriteOrigin(this.manifest, decoration.sprite);
      const anchor = tileAnchor(decoration.x, decoration.y);
      const depth = isoDepth(decoration.x, decoration.y, DEPTH.decorationSub) + 1;

      const decorationImage = this.add
        .image(anchor.x, anchor.y, ref.key, ref.frame)
        .setOrigin(origin[0], origin[1]);
      this.fitToLogicalSize(decorationImage, ref, size);
      this.track(decorationImage.setDepth(depth));

      if (this.showLabels) {
        this.label(decoration.sprite, anchor.x, anchor.y - size.height, depth);
      }
    }
  }

  private drawObjects(room: RuntimeSubRoom): void {
    for (const object of room.objects) {
      const state = currentObjectState(this.objectState, object);
      const spriteId = resolveObjectStateSprite(object, state);
      const frame = resolveSpriteFrame(this.manifest, spriteId);
      const explicitSize = spriteSize(this.manifest, spriteId);
      const ref = this.resolver.resolve(
        frame,
        explicitSize ? { width: explicitSize[0], height: explicitSize[1] } : SPRITE_SIZE,
      );
      const size = this.resolveDisplaySize(explicitSize, ref, SPRITE_SIZE);
      const origin = spriteOrigin(this.manifest, spriteId);
      const anchor = tileAnchor(object.position.x, object.position.y);
      const depth = isoDepth(object.position.x, object.position.y, DEPTH.objectSub) + 1;

      const glow = this.track(
        this.add
          .ellipse(
            anchor.x,
            anchor.y - size.height * 0.35,
            size.width * 0.72,
            size.height * 0.22,
            0xffe08a,
            0,
          )
          .setDepth(isoDepth(object.position.x, object.position.y, DEPTH.objectGlowSub) + 1)
          .setBlendMode(Phaser.BlendModes.ADD),
      );

      const sprite = this.add
        .sprite(anchor.x, anchor.y, ref.key, ref.frame)
        .setOrigin(origin[0], origin[1]);
      this.fitToLogicalSize(sprite, ref, size);
      this.track(sprite.setDepth(depth));

      const view: ObjectView = {
        object,
        sprite,
        glow,
        baseScaleX: sprite.scaleX,
        baseScaleY: sprite.scaleY,
      };
      this.objectViews.set(object.id, view);

      if (this.mode === "edit") {
        // En edición todo objeto es seleccionable (también los no interactuables).
        sprite.setInteractive({ useHandCursor: true });
        sprite.setData("objectId", object.id);
      } else if (object.interactable) {
        this.wireInteraction(view);
      }

      if (this.showLabels) {
        const suffix = object.lockedBy ? " (bloqueado)" : "";
        this.label(`${object.id}${suffix}`, anchor.x, anchor.y - size.height, depth);
      }
    }
  }

  /** Habilita brillo de pista, cursor y clic sobre un objeto interactuable. */
  private wireInteraction(view: ObjectView): void {
    const { sprite, object } = view;
    sprite.setInteractive({ useHandCursor: true });
    sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.setHover(object.id));
    sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this.clearHover(object.id));
    sprite.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (pointer: Phaser.Input.Pointer) => {
      // Phaser también escucha `mouseup` en `window`: soltar el ratón sobre un
      // botón o diálogo HTML que tapa el objeto no es un clic en el mundo (al
      // cerrar un diálogo, el avatar echaba a andar hacia lo que había debajo).
      if (!this.localInputEnabled || pointer.upElement !== this.sys.game.canvas) {
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
    if (!this.built) {
      // Phaser aún no ha llamado a `create`: se aplica al construir la escena.
      this.earlyObjectStates.set(objectId, state);
      return;
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
    const spriteId = resolveObjectStateSprite(object, state);
    const frame = resolveSpriteFrame(this.manifest, spriteId);
    const explicitSize = spriteSize(this.manifest, spriteId);
    const ref = this.resolver.resolve(
      frame,
      explicitSize ? { width: explicitSize[0], height: explicitSize[1] } : SPRITE_SIZE,
    );
    view.sprite.setTexture(ref.key, ref.frame);
    const size = this.resolveDisplaySize(explicitSize, ref, SPRITE_SIZE);
    const scale = this.resolver.displayScaleFor(ref, size);
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
    if (result.image) {
      this.emit({
        type: "show-image",
        objectId,
        image: result.image.image,
        ...(result.image.caption ? { caption: result.image.caption } : {}),
      });
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
    const spawn = this.pendingAvatarCell ?? room.spawns[0] ?? { x: 0, y: 0 };
    this.pendingAvatarCell = undefined;
    this.avatar = this.createAvatarController({ x: spawn.x, y: spawn.y });
    this.lastEmittedMove = { roomId: room.id, x: spawn.x, y: spawn.y, at: this.time?.now ?? 0 };
  }

  private createAvatarController(start: { x: number; y: number }): AvatarController {
    return new AvatarController({
      scene: this,
      resolver: this.resolver,
      manifest: this.manifest,
      collision: this.collision,
      start,
      characterId: this.localCharacterId,
      tint: this.localTint ?? playerColor(0),
    });
  }

  private setupInput(): void {
    if (this.mode === "edit") {
      this.setupEditInput();
      return;
    }
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

  // -------------------------------------------------------------------------
  // Modo edición
  // -------------------------------------------------------------------------

  /**
   * Sustituye el modelo y repinta la habitación activa sin fundido. El editor
   * lo llama cada vez que cambia el doc Yjs (propio o remoto). Si la habitación
   * activa ya no existe, pasa a la primera.
   */
  setModel(model: RuntimeModel): void {
    this.model = model;
    if (!model.subroomsById[this.activeRoomId]) {
      const first = model.subrooms[0]?.id;
      if (!first) {
        return;
      }
      this.activeRoomId = first;
    }
    this.objectState = createObjectStateMap(model);
    this.containers = createContainerStateMap(model);
    if (this.built && !this.transitioning) {
      this.buildRoom();
    }
  }

  /** Objeto seleccionado en el editor (contorno en su celda). */
  setSelection(objectId: string | undefined): void {
    this.selectedObjectId = objectId;
    if (this.built) {
      this.drawEditSelection();
    }
  }

  /**
   * Previsualización de arrastre: pinta el objeto en otra celda sin tocar el
   * modelo (el doc cambia al soltar). `undefined` lo devuelve a su sitio.
   */
  setDragPreview(objectId: string | undefined, cell?: EditCell): void {
    const previous = this.dragPreview;
    this.dragPreview = objectId && cell ? { objectId, cell } : undefined;
    if (previous && previous.objectId !== objectId) {
      this.placeObjectView(previous.objectId);
    }
    if (objectId) {
      this.placeObjectView(objectId);
    }
    if (this.built) {
      this.drawEditSelection();
    }
  }

  private placeObjectView(objectId: string): void {
    const view = this.objectViews.get(objectId);
    if (!view) {
      return;
    }
    const cell =
      this.dragPreview?.objectId === objectId ? this.dragPreview.cell : view.object.position;
    const anchor = tileAnchor(cell.x, cell.y);
    view.sprite.setPosition(anchor.x, anchor.y);
    view.sprite.setDepth(isoDepth(cell.x, cell.y, DEPTH.objectSub) + 1);
    view.sprite.setAlpha(this.dragPreview?.objectId === objectId ? 0.7 : 1);
  }

  private setupEditInput(): void {
    const onDown = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) =>
      this.emitEditPointer("down", pointer, over);
    const onMove = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) =>
      this.emitEditPointer("move", pointer, over);
    const onUp = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) =>
      this.emitEditPointer("up", pointer, over);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, onDown);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, onMove);
    this.input.on(Phaser.Input.Events.POINTER_UP, onUp);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off(Phaser.Input.Events.POINTER_DOWN, onDown);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, onMove);
      this.input.off(Phaser.Input.Events.POINTER_UP, onUp);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, onUp);
    });
  }

  private emitEditPointer(
    phase: "down" | "move" | "up",
    pointer: Phaser.Input.Pointer,
    over: Phaser.GameObjects.GameObject[] = [],
  ): void {
    if (this.transitioning || !this.built) {
      return;
    }
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tile = worldToTile(world.x, world.y);
    const cell = { x: tile.tx, y: tile.ty };
    const room = this.model.subroomsById[this.activeRoomId];
    const inside =
      !!room && cell.x >= 0 && cell.y >= 0 && cell.x < room.width && cell.y < room.height;

    const moved = this.hoverCell?.x !== cell.x || this.hoverCell?.y !== cell.y;
    this.hoverCell = cell;
    if (moved) {
      this.drawEditCursor(inside);
    }
    // Sin botón pulsado solo interesa el movimiento entre celdas.
    if (phase === "move" && !moved) {
      return;
    }

    const hit = over.find((object) => typeof object.getData?.("objectId") === "string");
    const objectId = hit?.getData("objectId") as string | undefined;
    const event: EditSceneEvent = {
      type: "pointer",
      phase,
      cell,
      inside,
      roomId: this.activeRoomId,
      ...(objectId ? { objectId } : {}),
    };
    this.events.emit(EDIT_EVENT, event);
  }

  /** Rejilla de celdas, cursor y selección (solo en edición). */
  private drawEditOverlay(room: RuntimeSubRoom): void {
    const grid = this.track(this.add.graphics());
    grid.setDepth(DEPTH.editGrid);
    grid.lineStyle(1, 0xe2e8f0, 0.18);
    for (let ty = 0; ty < room.height; ty += 1) {
      for (let tx = 0; tx < room.width; tx += 1) {
        const { x, y } = tileToWorld(tx, ty);
        strokeDiamond(grid, x, y, ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT / 2);
      }
    }
    this.editCursor = this.track(this.add.graphics()).setDepth(DEPTH.editCursor);
    this.editSelection = this.track(this.add.graphics()).setDepth(DEPTH.editCursor);
    if (this.dragPreview) {
      this.placeObjectView(this.dragPreview.objectId);
    }
    this.drawEditCursor(false);
    this.drawEditSelection();
  }

  private drawEditCursor(inside: boolean): void {
    const cursor = this.editCursor;
    if (!cursor) {
      return;
    }
    cursor.clear();
    if (!this.hoverCell || !inside) {
      return;
    }
    const { x, y } = tileToWorld(this.hoverCell.x, this.hoverCell.y);
    cursor.lineStyle(2, 0x38bdf8, 0.9);
    strokeDiamond(cursor, x, y, ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT / 2);
  }

  private drawEditSelection(): void {
    const selection = this.editSelection;
    if (!selection) {
      return;
    }
    selection.clear();
    const id = this.selectedObjectId;
    const object = id ? this.model.objectsById[id] : undefined;
    if (!id || !object || object.roomId !== this.activeRoomId) {
      return;
    }
    const cell = this.dragPreview?.objectId === id ? this.dragPreview.cell : object.position;
    const { x, y } = tileToWorld(cell.x, cell.y);
    selection.fillStyle(0xfacc15, 0.18);
    fillDiamond(selection, x, y, ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT / 2);
    selection.lineStyle(2, 0xfacc15, 1);
    strokeDiamond(selection, x, y, ISO_TILE_WIDTH / 2, ISO_TILE_HEIGHT / 2);
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

/** Contorno de un rombo isométrico centrado en `(x, y)`. */
function strokeDiamond(
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
  graphics.strokePath();
}

function parseColor(color: string): number {
  const normalized = color.startsWith("#") ? color.slice(1) : color;
  const value = Number.parseInt(normalized, 16);
  return Number.isNaN(value) ? 0x000000 : value;
}
