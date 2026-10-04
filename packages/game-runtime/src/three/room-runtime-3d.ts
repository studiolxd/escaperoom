import * as THREE from "three";
import { getModels3DCatalog, type Models3DCatalog } from "@escaperoom/shared/packs";
import { createRoomNav, initNav3D, type NavPoint, type RoomNav } from "@escaperoom/nav3d";
import type { RuntimeModel } from "../loader";
import { createObjectStateMap, currentObjectState, type ObjectStateMap } from "../world";
import { AVATAR_MOVE_EMIT_MS } from "../session/protocol";
import type { ScenePlayer } from "../phaser/room-scene";
import type { WorldSceneEvent } from "../phaser/world-events";
import { AvatarView, RemoteAvatar } from "./avatar";
import {
  CAMERA,
  FREE_CAMERA_SPEED,
  OrbitRig,
  walkForward,
  cameraRight,
  editorCameraPosition,
  freeCameraDirection,
  freeCameraFromLook,
  initialEditorCamera,
  moveFreeCamera,
  panPivot,
  rotateEditor,
  rotateFreeCamera,
  zoomEditor,
  type EditorCameraState,
  type FreeCameraState,
} from "./camera";
import {
  EditLayer,
  type EditPointer3D,
  type EditTarget3D,
  type GizmoDelta,
  type GizmoMode,
  type TransformChange3D,
} from "./edit";
import { EditInput, type EditPointerInput, type EditPointerType } from "./edit-input";
import { InputController } from "./input";
import { followPath, stepToward, yawOf, type Pose } from "./movement";
import { highlightedObject } from "./proximity";
import { createQualityMonitor, type Quality3D } from "./quality";
import { assetContext, buildRoomNavInput, RoomWorld } from "./world";

/** Cámara del observador: seguir a un jugador (órbita) o volar libremente. */
export type ObserverCamera =
  | { type: "follow"; playerId: string }
  | { type: "free"; roomId?: string };

export interface RoomRuntime3DOptions {
  initialRoomId?: string;
  /** URL base del pack (sin barra final): `/packs/medieval-v1`. Sin ella, todo son cajas. */
  packBaseUrl?: string;
  /** Catálogo del pack; por defecto `getModels3DCatalog(packId)`. Los tests inyectan uno. */
  catalog?: Models3DCatalog;
  /** Tileset (id del pack) de la sala, para resolver el catálogo por defecto. */
  packId?: string;
  /** Resuelve la URL de un modelo propio (`customModels[id].ref`). Sin él, caja. */
  resolveCustomModelUrl?: (ref: string) => string | undefined;
  avatar?: boolean; // por defecto true
  inputEnabled?: boolean; // por defecto true
  localPlayerId?: string;
  localCharacterId?: string;
  emitAvatarMoves?: boolean; // por defecto false
  backgroundColor?: string; // por defecto "#0b1120"
  /** Observador: sin avatar ni entrada de juego; cámaras `follow` y `free`. Por defecto `false`. */
  observer?: boolean;
  /**
   * `"edit"`: lienzo del editor 3D (specs/27 §8): sin avatar ni juego, cámara de editor, rejilla,
   * selección y gizmos; no escribe en el documento. Por defecto `"play"`. No se combina con `observer`.
   */
  mode?: "play" | "edit";
  /** Solo tests: no crea WebGLRenderer ni bucle de animación. */
  headless?: boolean;
}

const DEFAULT_BACKGROUND = "#0b1120";
const DEFAULT_TINT = "#e2e8f0";
const FADE_MS = 170;
const MAX_FRAME_S = 0.1;
const FOG_NEAR = 12;
const FOG_FAR = 30;
/** Distancia en planta (m) a la que un avatar «llega» a un objeto (`stepOn`: 0,35 m). */
const REACH = 1.75;
const REACH_STEP_ON = 0.35;
const OBJECT_TOLERANCE = { plan: 1.5, height: 1.5 } as const;
const MOVE_EMIT_DISTANCE = 0.05;
const MOVE_EMIT_YAW = 5;
const HEADLESS_ASPECT = 16 / 9;
const NO_KEYS = { forward: 0, right: 0 };
/** Movimiento (m) en planta a partir del cual se recalcula la altura visual de un personaje. */
const HEIGHT_RECALC_DISTANCE = 0.05;
/** Velocidad mínima (fracción de `WALK_SPEED`) con el joystick. */
const MIN_MOVE_VECTOR = 0.3;
/** Metros que avanza la cámara libre por muesca de rueda. */
const FREE_WHEEL_STEP_M = 1;
/** Tras construir una sala no se muestrea la calidad durante este tiempo (s). */
const QUALITY_MUTE_S = 2;
const OBSERVER_START_HEIGHT = 6;
const OBSERVER_START_PITCH = 45;

interface HeightSample {
  x: number;
  y: number;
  value: number;
}

interface Pending {
  objectId: string;
  itemId?: string | undefined;
}

const angleDiff = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/**
 * Runtime 3D de una sala (specs/27 §7): misma fachada que `RoomRuntime` (Phaser),
 * con Three.js. Siempre «dirigido por motor»: nunca resuelve diálogos ni paneles,
 * solo emite intenciones (`WorldSceneEvent`).
 */
export class RoomRuntime3D {
  /** Se resuelve cuando la navmesh de la habitación inicial está lista. */
  readonly ready: Promise<void>;

  private model: RuntimeModel;
  private readonly parent: HTMLElement;
  private readonly options: RoomRuntime3DOptions;
  private readonly headless: boolean;
  private readonly catalog: Models3DCatalog | undefined;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(CAMERA.fovDeg, HEADLESS_ASPECT, 0.1, 100);
  private readonly rig = new OrbitRig(this.camera);
  private readonly raycaster = new THREE.Raycaster();
  private readonly handlers = new Set<(event: WorldSceneEvent) => void>();
  private objectStates: ObjectStateMap;
  private readonly localPlayerId: string;
  private readonly avatarEnabled: boolean;
  private readonly emitAvatarMoves: boolean;
  private readonly observer: boolean;
  private readonly edit: boolean;

  private renderer: THREE.WebGLRenderer | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private input: InputController | undefined;
  private editInput: EditInput | undefined;
  private editLayer: EditLayer | undefined;
  private editCam: EditorCameraState = initialEditorCamera({ cols: 1, rows: 1 });
  private workHeightValue = 0;
  private readonly editHandlers = new Set<(event: EditPointer3D) => void>();
  private fadeOverlay: HTMLDivElement | undefined;
  private restoreParentPosition: string | undefined;
  private fadeTimers: ReturnType<typeof setTimeout>[] = [];

  private roomId: string;
  private nav: RoomNav | undefined;
  private world: RoomWorld | undefined;
  private inputEnabled: boolean;
  private destroyed = false;

  private avatar: AvatarView | undefined;
  private localTint = DEFAULT_TINT;
  private localCharacterId: string | undefined;
  private pose: Pose = { x: 0, y: 0, h: 0, yaw: 0 };
  private posePlaced = false;
  private moving = false;
  private path: NavPoint[] = [];
  private pending: Pending | undefined;
  private arrival: (() => void) | undefined;
  private moveVector: { x: number; y: number } | undefined;
  private localHeight: HeightSample | undefined;
  private readonly highlightHandlers = new Set<(objectId: string | undefined) => void>();
  private highlighted: string | undefined;
  private hovered: string | undefined;
  private pointer: { x: number; y: number } | undefined;

  private players: readonly ScenePlayer[] = [];
  private readonly remotes = new Map<
    string,
    { avatar: RemoteAvatar; characterId: string; height?: HeightSample | undefined }
  >();

  private observerCam: ObserverCamera = { type: "free" };
  private freeCam: FreeCameraState;
  private requestedRoom: string | undefined;
  private readonly observerRoomHandlers = new Set<(roomId: string) => void>();
  private followAnchor: THREE.Vector3 | undefined;

  private qualityAuto = true;
  private currentQuality: Quality3D = "high";
  private qualityMonitor = createQualityMonitor();
  private qualityMuteUntilMs = 0;
  private readonly qualityHandlers = new Set<(quality: Quality3D) => void>();

  private clockMs = 0;
  private lastEmit: { atMs: number; x: number; y: number; yaw: number } | undefined;
  private lastFrameAt: number | undefined;

  constructor(parent: HTMLElement, model: RuntimeModel, options: RoomRuntime3DOptions = {}) {
    if (model.dimension !== "3d") {
      throw new Error("RoomRuntime3D solo admite salas 3D");
    }
    this.model = model;
    this.parent = parent;
    this.options = options;
    this.headless = options.headless ?? false;
    this.roomId = options.initialRoomId ?? model.initialRoomId;
    if (!model.subroomsById[this.roomId]) {
      throw new Error(`RoomRuntime3D: la habitación "${this.roomId}" no existe`);
    }
    this.catalog =
      options.catalog ?? (options.packId ? getModels3DCatalog(options.packId) : undefined);
    this.objectStates = createObjectStateMap(model);
    this.inputEnabled = options.inputEnabled ?? true;
    this.localPlayerId = options.localPlayerId ?? "p0";
    this.localCharacterId = options.localCharacterId;
    this.observer = options.observer ?? false;
    this.edit = options.mode === "edit";
    if (this.edit && this.observer) {
      throw new Error("RoomRuntime3D: `observer` y `mode: \"edit\"` no se pueden combinar");
    }
    this.avatarEnabled = !this.observer && !this.edit && (options.avatar ?? true);
    this.emitAvatarMoves = options.emitAvatarMoves ?? false;

    const startRoom = model.subroomsById[this.roomId]!;
    this.freeCam = {
      x: startRoom.width / 2,
      y: startRoom.height / 2,
      h: OBSERVER_START_HEIGHT,
      azimuth: 0,
      pitch: OBSERVER_START_PITCH,
    };

    const background = options.backgroundColor ?? DEFAULT_BACKGROUND;
    this.scene.background = new THREE.Color(background);
    // En edición no hay niebla: se aleja la cámara hasta 60 m y debe verse toda la sala.
    if (!this.edit) this.scene.fog = new THREE.Fog(background, FOG_NEAR, FOG_FAR);
    if (this.edit) {
      this.qualityAuto = false;
      this.editLayer = new EditLayer(() => this.roomNavInput());
      this.scene.add(this.editLayer.group);
    }

    if (this.avatarEnabled) {
      this.avatar = new AvatarView({ tint: this.localTint, ...this.avatarSource(this.localCharacterId) });
      this.avatar.root.visible = this.localCharacterId !== "";
      this.scene.add(this.avatar.root);
    }

    if (!this.headless) this.mountRenderer();
    this.ready = this.init();
  }

  // ---------------------------------------------------------------- fachada

  get currentRoomId(): string {
    return this.roomId;
  }

  /** Cambia de habitación con un fundido de 170 ms. `onBuilt` se llama con la sala ya construida. */
  showRoom(roomId: string, onBuilt?: () => void): void {
    if (!this.model.subroomsById[roomId]) {
      throw new Error(`RoomRuntime3D: la habitación "${roomId}" no existe`);
    }
    for (const timer of this.fadeTimers) clearTimeout(timer);
    this.fadeTimers = [];
    const rebuild = () => {
      if (this.destroyed) return;
      this.buildRoom(roomId);
      onBuilt?.();
    };
    const overlay = this.fadeOverlay;
    if (this.headless || !overlay) {
      void this.ready.then(rebuild);
      return;
    }
    overlay.style.opacity = "1";
    this.fadeTimers.push(
      setTimeout(() => {
        void this.ready.then(() => {
          rebuild();
          overlay.style.opacity = "0";
        });
      }, FADE_MS),
    );
  }

  placeAvatar(x: number, y: number, h?: number, yaw?: number): void {
    if (this.observer || this.edit) return;
    const wanted: NavPoint = { x, y, h: h ?? this.pose.h };
    let snapped = this.nav?.closest(wanted) ?? null;
    if (!snapped && h === undefined) {
      // Sin altura conocida (llamada al estilo 2D): acepta la navmesh a cualquier altura.
      snapped = this.nav?.closest(wanted, { plan: 0.35, height: 32 }) ?? null;
    }
    this.pose = {
      x: snapped?.x ?? x,
      y: snapped?.y ?? y,
      h: snapped?.h ?? wanted.h,
      yaw: yaw ?? this.pose.yaw,
    };
    this.posePlaced = true;
    this.clearRoute();
    this.localHeight = undefined;
    this.moving = false;
    this.lastEmit = { atMs: -Infinity, x: this.pose.x, y: this.pose.y, yaw: this.pose.yaw };
    this.world?.updateTorches(this.pose, this.objectStates, true);
    this.syncAvatarView();
  }

  /** Posición del avatar local en el plano lógico, con decimales. */
  get avatarCell(): { x: number; y: number } | undefined {
    if (!this.avatar || !this.posePlaced) return undefined;
    return { x: this.pose.x, y: this.pose.y };
  }

  get avatarPose(): { x: number; y: number; h: number; yaw: number } | undefined {
    if (!this.avatar || !this.posePlaced) return undefined;
    return { ...this.pose };
  }

  setLocalTint(tint: string): void {
    this.localTint = tint;
    this.avatar?.setTint(tint);
  }

  setLocalCharacter(characterId: string): void {
    this.localCharacterId = characterId;
    if (!this.avatar) return;
    this.avatar.root.visible = characterId !== "";
    const source = this.avatarSource(characterId);
    this.avatar.setCharacter(source.entry, source.url);
  }

  setBackgroundColor(hex: string): void {
    (this.scene.background as THREE.Color).set(hex);
    this.scene.fog?.color.set(hex);
  }

  setPlayers(players: readonly ScenePlayer[]): void {
    if (this.edit) return;
    this.players = players;
    this.syncRemotes();
    this.syncObserverFollow();
  }

  setObjectState(objectId: string, state: string): void {
    if (!this.model.objectsById[objectId]) return;
    this.objectStates[objectId] = state;
    this.world?.setObjectState(objectId, state);
    this.world?.updateTorches(undefined, this.objectStates, true);
    if (!this.isObjectInteractive(objectId)) {
      if (this.pending?.objectId === objectId) this.clearRoute();
      if (this.highlighted === objectId) this.setHighlighted(undefined);
      if (this.hovered === objectId) this.hovered = undefined;
    }
  }

  /** Emite `interact` como si el jugador hubiera pulsado el objeto. */
  inspectObject(objectId: string): void {
    this.emit({ type: "interact", objectId });
  }

  isObjectInteractive(objectId: string): boolean {
    const object = this.model.objectsById[objectId];
    if (!object || !this.world?.objects.has(objectId)) return false;
    return object.interactable && currentObjectState(this.objectStates, object) !== "oculto";
  }

  /** Punto (fracción 0–1 del lienzo) donde se ve el centro del objeto, o `undefined`. */
  getObjectScreenFraction(objectId: string): { x: number; y: number } | undefined {
    const entry = this.world?.objects.get(objectId);
    if (!entry) return undefined;
    const box = new THREE.Box3().setFromObject(entry.slot.holder);
    if (box.isEmpty()) return undefined;
    this.camera.updateMatrixWorld();
    const p = box.getCenter(new THREE.Vector3()).project(this.camera);
    if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) return undefined;
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }

  setInputEnabled(enabled: boolean): void {
    if (this.inputEnabled === enabled) return;
    this.inputEnabled = enabled;
    if (!enabled) {
      this.clearRoute();
      this.moveVector = undefined;
      this.input?.clearKeys();
    }
  }

  /**
   * Camina por la navmesh hasta el punto más cercano a `point`. `onArrive` se llama al llegar,
   * o de inmediato si no hay ruta. Una ruta nueva, WASD, el joystick o `placeAvatar` cancelan la
   * anterior SIN llamar a su `onArrive`. Devuelve `false` si no hay ruta (y en el observador, donde
   * no hace nada ni llama a `onArrive`).
   */
  walkTo(point: { x: number; y: number; h?: number }, onArrive?: () => void): boolean {
    if (this.edit || this.observer || !this.nav || !this.avatar || !this.posePlaced || !this.inputEnabled) {
      return false;
    }
    this.clearRoute();
    const route = this.routeTo(point);
    if (!route) {
      onArrive?.();
      return false;
    }
    if (route.length === 0) {
      onArrive?.();
      return true;
    }
    this.path = route;
    this.arrival = onArrive;
    return true;
  }

  /** Igual que el clic sobre un objeto: camina hasta él y emite `interact` (o `use-item`/`interact-direct` con ítem). */
  walkToObject(objectId: string, itemId?: string): void {
    if (this.observer || this.edit) return;
    this.interactWith(objectId, itemId);
  }

  /**
   * Movimiento continuo pedido desde fuera (joystick): vector en pantalla, x = derecha, y = arriba,
   * módulo ≤ 1. `null` = suelta. Equivale a WASD (con teclado pulsado manda el teclado); velocidad =
   * `WALK_SPEED` × módulo, mínimo 0,3. En el observador mueve la cámara libre.
   */
  setMoveVector(v: { x: number; y: number } | null): void {
    this.moveVector = v && (v.x !== 0 || v.y !== 0) ? { x: v.x, y: v.y } : undefined;
  }

  /** Id del objeto resaltado por proximidad ahora mismo, o `undefined`. */
  get highlightedObjectId(): string | undefined {
    return this.highlighted;
  }

  /** Se llama cada vez que cambia el objeto resaltado por proximidad (no el de hover). */
  onHighlightChange(handler: (objectId: string | undefined) => void): () => void {
    this.highlightHandlers.add(handler);
    return () => {
      this.highlightHandlers.delete(handler);
    };
  }

  /** Lo mismo que pulsar E: emite `interact` del resaltado. Devuelve `false` si no hay. */
  interactHighlighted(): boolean {
    if (this.observer || this.edit || !this.inputEnabled || !this.avatar || !this.highlighted) return false;
    this.avatar.playInteract();
    this.emit({ type: "interact", objectId: this.highlighted });
    return true;
  }

  // ---- observador

  setObserverCamera(camera: ObserverCamera): void {
    if (!this.observer || this.edit) return;
    if (camera.type === "follow") {
      const player = this.players.find((p) => p.id === camera.playerId);
      if (!player || !player.connected || !this.model.subroomsById[player.roomId]) {
        this.enterFree();
        return;
      }
      this.observerCam = { type: "follow", playerId: camera.playerId };
      this.rig.reset(player.yaw ?? 0);
      this.followAnchor = undefined;
      this.syncObserverFollow();
      return;
    }
    this.enterFree(camera.roomId);
  }

  get observerCamera(): ObserverCamera {
    return this.observerCam;
  }

  /** Se llama cuando el runtime cambia de habitación por su cuenta (al seguir a un jugador). */
  onObserverRoomChange(handler: (roomId: string) => void): () => void {
    this.observerRoomHandlers.add(handler);
    return () => {
      this.observerRoomHandlers.delete(handler);
    };
  }

  // ---- calidad

  /** `"auto"` (por defecto) empieza en alta y baja sola; fijar un valor desactiva el automático. */
  setQuality(quality: Quality3D | "auto"): void {
    if (this.edit) return; // calidad fija alta, sin sombras
    if (quality === "auto") {
      this.qualityAuto = true;
      this.qualityMonitor = createQualityMonitor();
      this.applyQuality("high");
      return;
    }
    this.qualityAuto = false;
    this.applyQuality(quality);
  }

  get quality(): Quality3D {
    return this.currentQuality;
  }

  onQualityChange(handler: (quality: Quality3D) => void): () => void {
    this.qualityHandlers.add(handler);
    return () => {
      this.qualityHandlers.delete(handler);
    };
  }

  /** Suelta un ítem del inventario en coordenadas de cliente; devuelve el objeto que lo recibe. */
  dropItemAt(itemId: string, screenX: number, screenY: number): string | undefined {
    if (this.edit || !this.renderer || !this.avatar || !this.posePlaced) return undefined;
    const objectId = this.pickObject(screenX, screenY);
    if (!objectId) return undefined;
    this.interactWith(objectId, itemId);
    return objectId;
  }

  onWorldEvent(handler: (event: WorldSceneEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer?.setAnimationLoop(null);
    for (const timer of this.fadeTimers) clearTimeout(timer);
    this.fadeTimers = [];
    this.input?.dispose();
    this.editInput?.dispose();
    this.editLayer?.dispose();
    this.editHandlers.clear();
    this.resizeObserver?.disconnect();
    this.disposeRoom();
    for (const { avatar } of this.remotes.values()) avatar.view.dispose();
    this.remotes.clear();
    this.avatar?.dispose();
    this.handlers.clear();
    this.highlightHandlers.clear();
    this.observerRoomHandlers.clear();
    this.qualityHandlers.clear();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    this.fadeOverlay?.remove();
    if (this.restoreParentPosition !== undefined) {
      this.parent.style.position = this.restoreParentPosition;
    }
  }

  // ---------------------------------------------------------------- edición

  private requireEdit(method: string): EditLayer {
    if (!this.editLayer) throw new Error(`RoomRuntime3D.${method} solo existe con mode: "edit"`);
    return this.editLayer;
  }

  /** Sustituye el modelo y repinta SOLO lo que cambió (por id); no mueve la cámara ni funde. */
  setModel(model: RuntimeModel): void {
    const layer = this.requireEdit("setModel");
    if (model.dimension !== "3d") throw new Error("RoomRuntime3D solo admite salas 3D");
    const first = model.subrooms[0];
    if (!first) throw new Error("RoomRuntime3D.setModel: el modelo no tiene habitaciones");
    this.model = model;
    this.objectStates = createObjectStateMap(model);
    const world = this.world;
    if (!world) return; // `init` construirá la sala con este modelo
    const room = model.subroomsById[this.roomId];
    if (!room) {
      this.buildRoom(first.id);
      return;
    }
    world.sync(model, room, this.objectStates, (key) => layer.isHeld(key));
    world.updateTorches(undefined, this.objectStates, true);
    layer.refresh(room);
  }

  /**
   * Vuelve a resolver la URL de los modelos propios que ahora se pintan como caja y, si ya hay
   * URL, carga el GLB y sustituye la caja. No hace nada con los que ya tienen su GLB.
   */
  refreshCustomModels(): void {
    this.world?.refreshCustomModels();
  }

  /** Altura del plano de trabajo (m): la rejilla y el picking del suelo usan este plano. */
  setWorkHeight(h: number): void {
    const layer = this.requireEdit("setWorkHeight");
    this.workHeightValue = h;
    this.editCam = { ...this.editCam, pivot: { ...this.editCam.pivot, y: h } };
    layer.setWorkHeight(h);
  }

  get workHeight(): number {
    return this.workHeightValue;
  }

  /** Puntero sobre el lienzo (solo con el botón izquierdo sin Espacio; lo demás es cámara). */
  onEditEvent(handler: (event: EditPointer3D) => void): () => void {
    this.editHandlers.add(handler);
    return () => {
      this.editHandlers.delete(handler);
    };
  }

  /** Elementos seleccionados (contorno y caja); `[]` = nada. Ids inexistentes se ignoran. */
  setSelection(targets: readonly EditTarget3D[]): void {
    this.editLayer?.setSelection(targets);
  }

  /** Pieza u objeto «en la mano» que sigue al puntero antes de colocarse; `null` lo quita. */
  setGhost(
    ghost: { model: string; x: number; y: number; h: number; yaw: number; scale?: number } | null,
  ): void {
    this.editLayer?.setGhost(ghost);
  }

  /** Gizmo sobre la selección; `null` = sin gizmo. */
  setGizmoMode(mode: GizmoMode | null): void {
    this.editLayer?.setGizmoMode(mode);
  }

  /** Imán: paso de traslación en m (0 = libre) y de giro en grados (0 = libre). */
  setSnap(snap: { move: number; yaw: number }): void {
    this.editLayer?.setSnap(snap);
  }

  /** Mientras se arrastra un gizmo (cada fotograma con cambio) y al soltar (`final: true`). */
  onTransform(
    handler: (changes: readonly TransformChange3D[], final: boolean) => void,
  ): () => void {
    return this.editLayer?.onTransform(handler) ?? (() => undefined);
  }

  /** Dibuja (o no) la navmesh de la habitación sobre el suelo. */
  setNavmeshVisible(visible: boolean): void {
    this.editLayer?.setNavmeshVisible(visible);
  }

  // ------------------------------------------------- solo headless (tests)

  /**
   * Simula un evento de puntero del modo edición en coordenadas normalizadas (−1…1, y hacia
   * arriba). Solo con `headless: true`.
   */
  simulatePointer(
    type: EditPointerType,
    ndcX: number,
    ndcY: number,
    modifiers: Partial<Omit<EditPointerInput, "type" | "clientX" | "clientY">> = {},
  ): void {
    this.requireHeadless("simulatePointer");
    this.requireEdit("simulatePointer");
    this.emitEditPointer(type, new THREE.Vector2(ndcX, ndcY), {
      button: 0,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      ...modifiers,
    });
  }

  /**
   * Aplica un gesto de gizmo con la misma función que usa el arrastre. Los incrementos son
   * respecto al inicio del gesto (`dscale` es un factor); `final: true` lo cierra. Devuelve los
   * incrementos efectivos tras el imán. Solo con `headless: true`.
   */
  applyGizmoDelta(delta: Partial<GizmoDelta>, final = false): GizmoDelta {
    this.requireHeadless("applyGizmoDelta");
    return this.requireEdit("applyGizmoDelta").applyGizmoDelta(delta, final);
  }

  /** Ejecuta ya la regeneración pendiente de la navmesh visible y espera. Solo con `headless: true`. */
  flushNavmesh(): Promise<void> {
    this.requireHeadless("flushNavmesh");
    return this.requireEdit("flushNavmesh").flushNavmesh();
  }

  /** Avanza la simulación `dt` segundos. Solo con `headless: true`. */
  tick(dt: number): void {
    this.requireHeadless("tick");
    this.step(dt);
  }

  // ---------------------------------------------------------------- interno

  private requireHeadless(method: string): void {
    if (!this.headless) throw new Error(`RoomRuntime3D.${method} solo existe con headless: true`);
  }

  private emit(event: WorldSceneEvent): void {
    for (const handler of [...this.handlers]) handler(event);
  }

  private avatarSource(characterId: string | undefined) {
    const entry =
      characterId && this.catalog && Object.hasOwn(this.catalog.avatars, characterId)
        ? this.catalog.avatars[characterId]
        : undefined;
    const base = this.options.packBaseUrl;
    return { entry, url: entry && base !== undefined ? `${base}/${entry.file}` : undefined };
  }

  private async init(): Promise<void> {
    await initNav3D();
    if (this.destroyed) return;
    this.buildRoom(this.roomId);
  }

  private mountRenderer(): void {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.enabled = this.currentQuality === "high" && !this.edit;
    renderer.setPixelRatio(this.pixelRatioFor(this.currentQuality));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    this.renderer = renderer;
    this.resize();
    this.parent.appendChild(renderer.domElement);

    if (getComputedStyle(this.parent).position === "static") {
      this.restoreParentPosition = this.parent.style.position;
      this.parent.style.position = "relative";
    }
    const overlay = document.createElement("div");
    overlay.style.cssText = `position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity ${FADE_MS}ms linear`;
    this.parent.appendChild(overlay);
    this.fadeOverlay = overlay;

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.parent);
    }

    if (this.edit && this.editLayer) {
      // Los controles del gizmo se registran antes que la entrada: su `pointerdown` va primero.
      this.editLayer.attachGizmo(this.camera, renderer.domElement);
      this.editInput = new EditInput(
        renderer.domElement,
        {
          onPointer: (e) => this.handleEditPointer(e),
          onOrbit: (dx, dy) => {
            this.editCam = rotateEditor(this.editCam, dx, dy);
          },
          onPan: (dx, dy) => {
            this.editCam = panPivot(this.editCam, dx, dy, this.parent.clientHeight);
          },
          onWheel: (steps) => {
            this.editCam = zoomEditor(this.editCam, steps);
          },
          onFocusKey: () => this.focusSelection(),
          onLeave: () => undefined,
        },
        () => this.editLayer?.gizmoDragging ?? false,
      );
    } else {
      this.input = this.createGameInput(renderer);
    }

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - (this.lastFrameAt ?? now)) / 1000, MAX_FRAME_S);
      this.lastFrameAt = now;
      this.step(dt);
      renderer.render(this.scene, this.camera);
    });
  }

  private createGameInput(renderer: THREE.WebGLRenderer): InputController {
    return new InputController(
      renderer.domElement,
      {
        onClick: (x, y) => this.handleClick(x, y),
        onDrag: (dx, dy) => this.handleDrag(dx, dy),
        onWheel: (steps) => this.handleWheel(steps),
        onHover: (x, y) => {
          this.pointer = x === undefined || y === undefined ? undefined : { x, y };
        },
        onInteractKey: () => {
          this.interactHighlighted();
        },
        onMoveKey: () => undefined,
      },
      { observer: this.observer },
    );
  }

  private resize(): void {
    if (!this.renderer) return;
    const width = Math.max(1, this.parent.clientWidth);
    const height = Math.max(1, this.parent.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private disposeRoom(): void {
    this.world?.dispose();
    this.world = undefined;
    this.nav?.destroy();
    this.nav = undefined;
  }

  private buildRoom(roomId: string): void {
    const room = this.model.subroomsById[roomId]!;
    this.disposeRoom();
    this.roomId = roomId;
    this.requestedRoom = undefined;
    this.clearRoute();
    this.localHeight = undefined;
    for (const remote of this.remotes.values()) remote.height = undefined;
    this.setHighlighted(undefined);
    this.hovered = undefined;
    this.qualityMuteUntilMs = this.clockMs + QUALITY_MUTE_S * 1000;

    // En edición no hay navmesh de juego: la colisión es una malla vacía.
    const input = this.edit
      ? { positions: new Float32Array(0), indices: new Uint32Array(0) }
      : buildRoomNavInput(this.model, room, this.catalog);
    this.nav = this.edit ? undefined : createRoomNav(input);
    this.world = new RoomWorld(
      this.model,
      room,
      assetContext(this.model, {
        catalog: this.catalog,
        packBaseUrl: this.options.packBaseUrl,
        resolveCustomModelUrl: this.options.resolveCustomModelUrl,
      }),
      input,
      this.objectStates,
      { quality: this.currentQuality, edit: this.edit },
    );
    this.scene.add(this.world.group);

    if (this.edit && this.editLayer) {
      this.world.updateTorches({ x: room.width / 2, y: room.height / 2 }, this.objectStates, true);
      this.editLayer.bind(this.world, room);
      this.editCam = initialEditorCamera(
        { cols: room.width, rows: room.height },
        this.workHeightValue,
      );
      this.updateCamera(0);
      return;
    }

    const spawn = room.spawns[0];
    if (spawn) this.placeAvatar(spawn.x, spawn.y, spawn.h, spawn.yaw);
    else this.placeAvatar(room.width / 2, room.height / 2, undefined, 0);
    if (this.observer) {
      this.rig.snap();
      this.freeCam = moveFreeCamera(this.freeCam, { forward: 0, right: 0, up: 0 }, 0, {
        cols: room.width,
        rows: room.height,
      });
    } else {
      this.rig.reset(this.pose.yaw);
    }
    this.syncRemotes();
    this.updateCamera(0);
  }

  // ---- edición

  /** Geometría de colisión de la habitación visible (para dibujar la navmesh en el editor). */
  private roomNavInput() {
    const room = this.model.subroomsById[this.roomId];
    return room ? buildRoomNavInput(this.model, room, this.catalog) : undefined;
  }

  private handleEditPointer(input: EditPointerInput): void {
    const ndc = this.ndc(input.clientX, input.clientY);
    if (ndc) this.emitEditPointer(input.type, ndc, input);
  }

  private emitEditPointer(
    type: EditPointerType,
    ndc: THREE.Vector2,
    mods: Pick<EditPointerInput, "button" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">,
  ): void {
    const layer = this.editLayer;
    if (!layer || this.editHandlers.size === 0) return;
    this.scene.updateMatrixWorld(); // en headless no hay fotograma que lo haga
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = Infinity;
    const event: EditPointer3D = {
      type,
      point: layer.pickPoint(this.raycaster),
      target: layer.pick(this.raycaster),
      button: mods.button,
      shiftKey: mods.shiftKey,
      altKey: mods.altKey,
      ctrlKey: mods.ctrlKey,
      metaKey: mods.metaKey,
    };
    for (const handler of [...this.editHandlers]) handler(event);
  }

  /** Tecla F: centra el pivote en la selección (o en el centro de la habitación). */
  private focusSelection(): void {
    const room = this.model.subroomsById[this.roomId];
    const center = this.editLayer?.selectionCenter();
    const x = center?.x ?? (room ? room.width / 2 : this.editCam.pivot.x);
    const z = center?.z ?? (room ? room.height / 2 : this.editCam.pivot.z);
    this.editCam = { ...this.editCam, pivot: { x, y: this.workHeightValue, z } };
  }

  // ---- interacción

  private handleClick(clientX: number, clientY: number): void {
    if (!this.inputEnabled || !this.avatar || !this.posePlaced || !this.world) return;
    const objectId = this.pickObject(clientX, clientY);
    if (objectId) {
      this.interactWith(objectId);
      return;
    }
    const hit = this.castRay(clientX, clientY, [this.world.collision])[0];
    if (hit) this.walkTo({ x: hit.point.x, y: hit.point.z, h: hit.point.y });
  }

  private handleDrag(dx: number, dy: number): void {
    if (this.observer && this.observerCam.type === "free") {
      this.freeCam = rotateFreeCamera(this.freeCam, dx, dy);
    } else {
      this.rig.rotate(dx, dy);
    }
  }

  private handleWheel(steps: number): void {
    if (this.observer && this.observerCam.type === "free") {
      const room = this.model.subroomsById[this.roomId]!;
      this.freeCam = moveFreeCamera(
        this.freeCam,
        { forward: -Math.sign(steps), right: 0, up: 0 },
        FREE_WHEEL_STEP_M / FREE_CAMERA_SPEED,
        { cols: room.width, rows: room.height },
      );
    } else {
      this.rig.zoom(steps);
    }
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 | undefined {
    const canvas = this.renderer?.domElement;
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
  }

  private castRay(
    clientX: number,
    clientY: number,
    targets: THREE.Object3D[],
  ): THREE.Intersection[] {
    const ndc = this.ndc(clientX, clientY);
    if (!ndc) return [];
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = Infinity;
    return this.raycaster.intersectObjects(targets, true);
  }

  /** Id del objeto interactivo bajo un punto de pantalla (el más cercano). */
  private pickObject(clientX: number, clientY: number): string | undefined {
    if (!this.world) return undefined;
    const hit = this.castRay(clientX, clientY, this.world.interactiveRoots())[0];
    let node: THREE.Object3D | null = hit?.object ?? null;
    while (node) {
      const id = node.userData.objectId as string | undefined;
      if (id) return id;
      node = node.parent;
    }
    return undefined;
  }

  /** Ruta hasta el punto más cercano a `point` (altura actual si falta; amplia si no hay punto). */
  private routeTo(point: { x: number; y: number; h?: number }): NavPoint[] | null {
    if (!this.nav) return null;
    const wanted: NavPoint = { x: point.x, y: point.y, h: point.h ?? this.pose.h };
    let dest = this.nav.closest(wanted);
    if (!dest && point.h === undefined) {
      dest = this.nav.closest(wanted, { plan: 0.35, height: 32 });
    }
    return dest ? this.nav.path(this.pose, dest) : null;
  }

  /** Cancela la ruta y el objetivo pendiente SIN llamar a `onArrive`. */
  private clearRoute(): void {
    this.path = [];
    this.pending = undefined;
    this.arrival = undefined;
  }

  private setHighlighted(objectId: string | undefined): void {
    if (this.highlighted === objectId) return;
    this.highlighted = objectId;
    for (const handler of [...this.highlightHandlers]) handler(objectId);
  }

  /** Camina hasta el objeto y, al llegar, emite `interact` (o `use-item`/`interact-direct` con ítem). */
  private interactWith(objectId: string, itemId?: string): void {
    if (!this.nav || !this.world || !this.isObjectInteractive(objectId)) return;
    const object = this.model.objectsById[objectId]!;
    const at = object.transform;
    if (!at) return;
    const pending: Pending = { objectId, itemId };
    this.clearRoute();
    if (this.reached(pending)) {
      this.finishInteraction(pending);
      return;
    }
    const dest = this.nav.closest({ x: at.x, y: at.y, h: at.h }, OBJECT_TOLERANCE);
    const route = dest ? this.nav.path(this.pose, dest) : null;
    if (!route) {
      this.finishInteraction(pending);
      return;
    }
    this.path = route;
    this.pending = pending;
  }

  private reached(pending: Pending): boolean {
    const object = this.model.objectsById[pending.objectId];
    const at = object?.transform;
    if (!object || !at) return true;
    const reach = object.stepOn ? REACH_STEP_ON : REACH;
    return Math.hypot(at.x - this.pose.x, at.y - this.pose.y) <= reach;
  }

  private finishInteraction(pending: Pending): void {
    this.clearRoute();
    this.moving = false;
    const object = this.model.objectsById[pending.objectId];
    const at = object?.transform;
    if (at && Math.hypot(at.x - this.pose.x, at.y - this.pose.y) > 1e-6) {
      this.pose = { ...this.pose, yaw: yawOf(at.x - this.pose.x, at.y - this.pose.y) };
    }
    this.avatar?.playInteract();
    if (pending.itemId === undefined) {
      this.emit({ type: "interact", objectId: pending.objectId });
    } else if (object?.useItemIds?.includes(pending.itemId)) {
      this.emit({ type: "use-item", itemId: pending.itemId, objectId: pending.objectId });
    } else {
      this.emit({ type: "interact-direct", objectId: pending.objectId });
    }
  }

  // ---- simulación

  private step(dt: number): void {
    if (this.destroyed) return;
    this.clockMs += dt * 1000;
    const nav = this.nav;
    const world = this.world;

    if (this.edit) {
      world?.update(dt);
      this.editLayer?.update();
      this.updateCamera(dt);
      return;
    }

    if (nav && world && this.avatar && this.posePlaced && this.inputEnabled) {
      this.moveLocal(dt, nav);
      this.emitMove();
      world.updateTorches(this.pose, this.objectStates, false);
      this.setHighlighted(highlightedObject(this.pose, this.interactiveCandidates()));
    } else {
      this.setHighlighted(undefined);
      this.moving = false;
    }
    this.sampleQuality(dt);

    if (world) {
      this.updateHover();
      // Decisión del usuario (2026-10-05): el objeto cercano NO se contornea; solo el hover.
      world.setOutlined(new Set(this.hovered !== undefined ? [this.hovered] : []));
      world.update(dt);
    }

    this.avatar?.update(dt);
    this.avatar?.setMoving(this.moving);
    this.syncAvatarView();
    if (!this.observer && this.posePlaced) this.rig.recenter(dt, this.pose.yaw, this.moving);
    this.updateRemotes(dt);
    this.updateCamera(dt);
  }

  private moveLocal(dt: number, nav: RoomNav): void {
    const keys = this.input?.axes() ?? NO_KEYS;
    const keyboard = keys.forward !== 0 || keys.right !== 0;
    const vector = keyboard ? undefined : this.moveVector;
    if (keyboard || vector) {
      this.clearRoute();
      const axes = keyboard ? keys : { forward: vector!.y, right: vector!.x };
      const speed = keyboard
        ? 1
        : Math.min(1, Math.max(MIN_MOVE_VECTOR, Math.hypot(vector!.x, vector!.y)));
      const fwd = walkForward(this.rig.azimuth);
      const right = cameraRight(fwd);
      const result = stepToward(
        this.pose,
        {
          x: fwd.x * axes.forward + right.x * axes.right,
          y: fwd.y * axes.forward + right.y * axes.right,
        },
        dt,
        nav,
        speed,
      );
      this.pose = result.pose;
      this.moving = result.moving;
      return;
    }
    if (this.path.length === 0) {
      this.moving = false;
      return;
    }
    const result = followPath(this.pose, this.path, dt);
    this.pose = result.pose;
    this.path = result.rest;
    this.moving = result.moving;
    if (this.pending && (this.path.length === 0 || this.reached(this.pending))) {
      this.finishInteraction(this.pending);
    } else if (!this.pending && this.arrival && this.path.length === 0) {
      const onArrive = this.arrival;
      this.arrival = undefined;
      this.moving = false;
      onArrive();
    }
  }

  private emitMove(): void {
    if (!this.emitAvatarMoves || !this.lastEmit) return;
    const last = this.lastEmit;
    if (this.clockMs - last.atMs < AVATAR_MOVE_EMIT_MS) return;
    const moved = Math.hypot(this.pose.x - last.x, this.pose.y - last.y);
    if (moved <= MOVE_EMIT_DISTANCE && angleDiff(this.pose.yaw, last.yaw) <= MOVE_EMIT_YAW) return;
    this.lastEmit = { atMs: this.clockMs, x: this.pose.x, y: this.pose.y, yaw: this.pose.yaw };
    this.emit({
      type: "avatar-move",
      roomId: this.roomId,
      x: this.pose.x,
      y: this.pose.y,
      h: this.pose.h,
      yaw: this.pose.yaw,
    });
  }

  private interactiveCandidates(): { id: string; x: number; y: number; h: number }[] {
    const out: { id: string; x: number; y: number; h: number }[] = [];
    for (const [id, entry] of this.world?.objects ?? []) {
      const at = entry.object.transform;
      if (at && this.isObjectInteractive(id)) out.push({ id, x: at.x, y: at.y, h: at.h });
    }
    return out;
  }

  private updateHover(): void {
    if (!this.pointer || !this.inputEnabled || this.observer) {
      this.hovered = undefined;
      return;
    }
    this.hovered = this.pickObject(this.pointer.x, this.pointer.y);
  }

  // ---- pintado

  /** Altura visual: primer impacto de un rayo hacia abajo desde `h + 1` contra la malla de colisión. */
  private visualHeight(x: number, h: number, y: number): number {
    const world = this.world;
    if (!world) return h;
    this.raycaster.set(new THREE.Vector3(x, h + 1, y), new THREE.Vector3(0, -1, 0));
    this.raycaster.far = Infinity;
    const hit = this.raycaster.intersectObject(world.collision, false)[0];
    return hit ? hit.point.y : h;
  }

  private syncAvatarView(): void {
    if (!this.avatar || !this.posePlaced) return;
    const { x, y, h, yaw } = this.pose;
    this.localHeight = this.sampleHeight(this.localHeight, x, h, y);
    this.avatar.setPose(x, this.localHeight.value, y, yaw);
  }

  /** Reutiliza la altura visual salvo que el personaje se haya movido más de 0,05 m en planta. */
  private sampleHeight(prev: HeightSample | undefined, x: number, h: number, y: number): HeightSample {
    if (prev && Math.hypot(x - prev.x, y - prev.y) <= HEIGHT_RECALC_DISTANCE) return prev;
    return { x, y, value: this.visualHeight(x, h, y) };
  }

  private syncRemotes(): void {
    const wanted = new Set<string>();
    for (const player of this.players) {
      if (!this.observer && player.id === this.localPlayerId) continue;
      if (player.roomId !== this.roomId || !player.connected) continue;
      wanted.add(player.id);
      let remote = this.remotes.get(player.id);
      if (!remote) {
        remote = {
          avatar: new RemoteAvatar({ tint: player.tint, ...this.avatarSource(player.characterId) }),
          characterId: player.characterId,
        };
        this.remotes.set(player.id, remote);
        this.scene.add(remote.avatar.view.root);
      } else if (remote.characterId !== player.characterId) {
        remote.characterId = player.characterId;
        const source = this.avatarSource(player.characterId);
        remote.avatar.view.setCharacter(source.entry, source.url);
      }
      remote.avatar.view.setTint(player.tint);
      remote.avatar.setTarget(player);
    }
    for (const [id, remote] of this.remotes) {
      if (wanted.has(id)) continue;
      remote.avatar.view.dispose();
      this.remotes.delete(id);
    }
  }

  private updateRemotes(dt: number): void {
    for (const remote of this.remotes.values()) {
      const { avatar } = remote;
      const moving = avatar.step(dt);
      const { x, y, h, yaw } = avatar.pose;
      remote.height = this.sampleHeight(remote.height, x, h, y);
      avatar.view.setPose(x, remote.height.value, y, yaw);
      avatar.view.setMoving(moving);
      avatar.view.update(dt);
    }
  }

  private updateCamera(dt: number): void {
    if (this.edit) {
      const at = editorCameraPosition(this.editCam);
      const pivot = this.editCam.pivot;
      this.camera.position.set(at.x, at.y, at.z);
      this.camera.lookAt(pivot.x, pivot.y, pivot.z);
      this.camera.updateMatrixWorld();
      return;
    }
    const room = this.model.subroomsById[this.roomId]!;
    if (this.observer && this.observerCam.type === "free") {
      this.moveFree(dt, room);
      const f = this.freeCam;
      const dir = freeCameraDirection(f);
      this.camera.position.set(f.x, f.h, f.y);
      this.camera.lookAt(f.x + dir.x, f.h + dir.y, f.y + dir.z);
      this.camera.updateMatrixWorld();
      return;
    }
    let anchor: THREE.Vector3;
    if (this.observer) {
      const followed =
        this.observerCam.type === "follow"
          ? this.remotes.get(this.observerCam.playerId)?.avatar.view.root.position
          : undefined;
      if (followed) this.followAnchor = followed.clone();
      anchor = this.followAnchor ?? new THREE.Vector3(room.width / 2, 0, room.height / 2);
    } else {
      anchor =
        this.avatar && this.posePlaced
          ? this.avatar.root.position
          : new THREE.Vector3(room.width / 2, 0, room.height / 2);
    }
    this.rig.update(dt, anchor, this.world?.cameraCollision);
    this.world?.updateOcclusion(dt, this.rig.focus, this.camera.position);
  }

  /** Cámara libre del observador: teclado (WASD, flechas, Q/E) o, sin teclas, el vector externo. */
  private moveFree(dt: number, room: { width: number; height: number }): void {
    if (dt <= 0 || !this.inputEnabled) return;
    const keys = this.input?.axes() ?? NO_KEYS;
    const up = this.input?.vertical() ?? 0;
    const keyboard = keys.forward !== 0 || keys.right !== 0;
    const external = keyboard ? undefined : this.moveVector;
    const forward = keyboard ? keys.forward : (external?.y ?? 0);
    const right = keyboard ? keys.right : (external?.x ?? 0);
    if (forward === 0 && right === 0 && up === 0) return;
    this.freeCam = moveFreeCamera(this.freeCam, { forward, right, up }, dt, {
      cols: room.width,
      rows: room.height,
    });
  }

  /** Entra en cámara libre desde donde está la cámara; con `roomId`, cambia antes de habitación. */
  private enterFree(roomId?: string): void {
    if (this.observerCam.type === "follow") {
      const d = this.camera.getWorldDirection(new THREE.Vector3());
      this.freeCam = freeCameraFromLook(this.camera.position, d);
    }
    this.observerCam = roomId === undefined ? { type: "free" } : { type: "free", roomId };
    if (roomId !== undefined && roomId !== this.roomId) this.showRoom(roomId);
  }

  /** Con `follow`: lleva la sala del jugador seguido o pasa a `free` si ya no está. */
  private syncObserverFollow(): void {
    const cam = this.observerCam;
    if (!this.observer || cam.type !== "follow") return;
    const player = this.players.find((p) => p.id === cam.playerId);
    if (!player || !player.connected || !this.model.subroomsById[player.roomId]) {
      this.enterFree();
      return;
    }
    if (player.roomId === this.roomId || player.roomId === this.requestedRoom) return;
    this.requestedRoom = player.roomId;
    this.showRoom(player.roomId);
    for (const handler of [...this.observerRoomHandlers]) handler(player.roomId);
  }

  // ---- calidad

  private pixelRatioFor(quality: Quality3D): number {
    return quality === "high" ? Math.min(globalThis.devicePixelRatio ?? 1, 2) : 1;
  }

  private applyQuality(quality: Quality3D): void {
    if (quality === this.currentQuality) return;
    this.currentQuality = quality;
    this.world?.setQuality(quality);
    if (this.renderer) {
      this.renderer.shadowMap.enabled = quality === "high";
      this.renderer.setPixelRatio(this.pixelRatioFor(quality));
      this.resize();
      // Cambiar el mapa de sombras en caliente obliga a recompilar los materiales.
      this.scene.traverse((node) => {
        const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          m.needsUpdate = true;
        }
      });
    }
    for (const handler of [...this.qualityHandlers]) handler(quality);
  }

  /** Calidad automática: solo baja; no muestrea justo tras cambiar de sala ni con la pestaña oculta. */
  private sampleQuality(dt: number): void {
    if (!this.qualityAuto || this.currentQuality === "low") return;
    if (this.clockMs < this.qualityMuteUntilMs) return;
    if (typeof document !== "undefined" && document.hidden) return;
    this.qualityMonitor.sample(dt);
    if (this.qualityMonitor.shouldDowngrade()) this.applyQuality("low");
  }
}
