import * as THREE from "three";
import type { Models3DCatalog } from "@escaperoom/shared/packs";
import { buildNavInputFromParts, type NavInput } from "@escaperoom/nav3d";
import type { Piece3D } from "@escaperoom/shared/schemas";
import type { RuntimeModel, RuntimeObject, RuntimeSubRoom } from "../loader";
import {
  resolveObjectStateAnimation,
  resolveObjectStateSprite,
  resolveTorchLights,
  currentObjectState,
  type ObjectStateMap,
} from "../world";
import { BoxFactory, instantiateModel, resolveVisual, type AssetContext } from "./assets";
import type { Quality3D } from "./quality";

export const MAX_TORCH_LIGHTS = 8;
/** Antorchas simultáneas en calidad baja. */
export const LOW_TORCH_LIGHTS = 4;
export const SHADOW_MAP_SIZE = 2048;
/** Dirección (hacia el sol) de la luz direccional. */
const SUN_DIRECTION = new THREE.Vector3(-0.7, 0.9, 0.5).normalize();
/** Altura (m) que se da a la caja de la habitación para encuadrar las sombras. */
const SHADOW_BOX_HEIGHT = 4;
/** Movimiento (m) del avatar a partir del cual se recalculan las antorchas más cercanas. */
export const TORCH_RECALC_DISTANCE = 1;
const TORCH_COLOR = 0xffb060;
const OUTLINE_SCALE = 1.04;

export function assetContext(
  model: RuntimeModel,
  options: {
    catalog: Models3DCatalog | undefined;
    packBaseUrl: string | undefined;
    resolveCustomModelUrl: ((ref: string) => string | undefined) | undefined;
  },
): AssetContext {
  return {
    catalog: options.catalog,
    customModels: model.customModels,
    packBaseUrl: options.packBaseUrl,
    resolveCustomModelUrl: options.resolveCustomModelUrl,
  };
}

/**
 * Geometría de colisión de una habitación (specs/27 §5.1): piezas y objetos que
 * bloquean. Mismo criterio que `buildNavInput`: todos menos puertas, `leadsTo` y `stepOn`.
 */
export function buildRoomNavInput(
  model: RuntimeModel,
  room: RuntimeSubRoom,
  catalog: Models3DCatalog | undefined,
): NavInput {
  const objects: { modelId: string; transform: NonNullable<RuntimeObject["transform"]> }[] = [];
  for (const object of room.objects) {
    if (!object.transform) continue;
    if (object.type === "puerta" || object.leadsTo !== undefined || object.stepOn) continue;
    objects.push({
      modelId: resolveObjectStateSprite(object, object.initialState),
      transform: object.transform,
    });
  }
  return buildNavInputFromParts({
    pieces: room.pieces,
    objects,
    catalog,
    customModels: model.customModels,
  });
}

/** Malla invisible con la geometría de la navmesh: suelo visual, clic en el suelo y colisión de cámara. */
export function createCollisionMesh(input: NavInput): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(input.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(input.indices, 1));
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false; // el raycaster no mira `visible`
  return mesh;
}

/** Categorías cuyas piezas frenan la cámara; el resto (y los objetos) se vuelve translúcido al taparla. */
const CAMERA_BLOCKING_KINDS: ReadonlySet<string> = new Set(["muro", "estructura", "desconocido"]);
/** Radio (m) del barrido cámara–personaje para decidir qué estorba. */
export const OCCLUSION_RADIUS = 0.3;
export const OCCLUDED_OPACITY = 0.3;
/** Segundos de la transición de opacidad al taparse/destaparse. */
export const OCCLUSION_FADE_S = 0.2;

export interface Placement {
  x: number;
  y: number;
  h: number;
  yaw: number;
  scale?: number | undefined;
}

/** Un modelo colocado (pieza u objeto): caja inmediata y GLB que la sustituye al llegar. */
export class ModelSlot {
  readonly holder = new THREE.Group();
  mixer: THREE.AnimationMixer | undefined;
  /** Id del modelo pintado ahora mismo (`undefined` antes del primer `set`). */
  modelId: string | undefined;
  private content: THREE.Object3D | undefined;
  /** Último visual pedido (para `refreshCustomModels`) y animación de estado. */
  private requested: { kind: string; url: string | undefined } | undefined;
  private animation: string | undefined;
  private token = 0;
  private opacity = 1;
  /** Opacidad pedida (edición/oculto) y multiplicador de oclusión de cámara; `opacity` es su producto. */
  private baseOpacity = 1;
  private occlusionFade = 1;
  private editOutline: THREE.Material | undefined;
  /** Materiales clonados para la opacidad: son nuestros y se liberan con el contenido. */
  private owned: THREE.Material[] = [];

  constructor(
    private readonly world: RoomWorld,
    placement: Placement,
  ) {
    this.place(placement);
  }

  /** Coloca el holder (idempotente). */
  place(placement: Placement): void {
    this.holder.position.set(placement.x, placement.h, placement.y);
    this.holder.rotation.y = (placement.yaw * Math.PI) / 180;
    this.holder.scale.setScalar(placement.scale ?? 1);
  }

  set(modelId: string, animation?: string): void {
    const token = ++this.token;
    this.modelId = modelId;
    this.animation = animation;
    const visual = resolveVisual(modelId, this.world.assets);
    this.requested = { kind: visual.kind, url: visual.url };
    this.clear();
    this.content = this.world.boxes.create(visual);
    this.world.markShadows(this.content);
    this.holder.add(this.content);
    this.applyDecor();
    if (!visual.url) return;
    instantiateModel(visual.url).then(
      (loaded) => {
        if (this.world.disposed || token !== this.token) return;
        this.clear();
        this.content = loaded.scene;
        this.world.markShadows(loaded.scene);
        this.holder.add(loaded.scene);
        this.applyDecor();
        const clip = animation
          ? THREE.AnimationClip.findByName(loaded.animations, animation)
          : undefined;
        if (clip) {
          this.mixer = new THREE.AnimationMixer(loaded.scene);
          const action = this.mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.play();
        }
      },
      () => {
        /* sin GLB: se queda la caja */
      },
    );
  }

  /** Vuelve a resolver el visual: si ahora hay otra URL (o otro tipo) lo repinta; si no, no hace nada. */
  refreshVisual(): void {
    if (this.modelId === undefined) return;
    const visual = resolveVisual(this.modelId, this.world.assets);
    if (visual.kind === this.requested?.kind && visual.url === this.requested?.url) return;
    this.set(this.modelId, this.animation);
  }

  /** Opacidad del modelo (edición: objetos ocultos y fantasma). 1 = opaco. */
  setOpacity(opacity: number): void {
    this.baseOpacity = opacity;
    this.refreshOpacity();
  }

  /** Multiplicador de opacidad por tapar la cámara (1 = no tapa). */
  setOcclusionFade(fade: number): void {
    this.occlusionFade = fade;
    this.refreshOpacity();
  }

  get occlusion(): number {
    return this.occlusionFade;
  }

  private refreshOpacity(): void {
    const opacity = this.baseOpacity * this.occlusionFade;
    if (this.opacity === opacity) return;
    this.opacity = opacity;
    this.applyDecor();
  }

  /** Contorno de selección (edición); `undefined` lo quita. */
  setEditOutline(material: THREE.Material | undefined): void {
    if (this.editOutline === material) return;
    this.editOutline = material;
    this.applyDecor();
  }

  /** Caja envolvente (mundo) de las mallas visibles, sin contar contornos. */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    this.holder.updateWorldMatrix(true, true);
    const part = new THREE.Box3();
    for (const mesh of this.meshes()) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
      box.union(part);
    }
    return box;
  }

  /** Mallas visibles de este modelo (para el contorno). */
  meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    this.content?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData.outline && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        out.push(mesh);
      }
    });
    return out;
  }

  /** Opacidad y contorno de edición sobre el contenido actual. */
  private applyDecor(): void {
    const content = this.content;
    if (!content) return;
    for (const mesh of this.meshes()) {
      for (const child of [...mesh.children]) {
        if (child.userData.editOutline) mesh.remove(child);
      }
      if (this.opacity < 1) {
        const clone = (m: THREE.Material) => {
          const own = m.clone();
          own.transparent = true;
          own.opacity = this.opacity;
          this.owned.push(own);
          return own;
        };
        if (!mesh.userData.ownMaterial) {
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
          mesh.userData.ownMaterial = true;
        } else {
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            m.opacity = this.opacity;
          }
        }
      } else if (mesh.userData.ownMaterial) {
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          m.opacity = 1;
          m.transparent = false;
        }
      }
      if (this.editOutline) {
        const outline = new THREE.Mesh(mesh.geometry, this.editOutline);
        outline.userData.outline = true;
        outline.userData.editOutline = true;
        outline.scale.setScalar(OUTLINE_SCALE);
        mesh.add(outline);
      }
    }
  }

  private clear(): void {
    this.mixer?.stopAllAction();
    this.mixer = undefined;
    if (this.content) this.holder.remove(this.content);
    this.content = undefined;
    for (const material of this.owned) material.dispose();
    this.owned = [];
  }

  invalidate(): void {
    this.token++;
  }

  /** Libera el contenido y descarta cualquier carga pendiente. */
  dispose(): void {
    this.invalidate();
    this.clear();
  }
}

export interface WorldObjectEntry {
  object: RuntimeObject;
  slot: ModelSlot;
  state: string;
}

export interface PieceEntry {
  piece: Piece3D;
  slot: ModelSlot;
}

export interface RoomWorldOptions {
  quality?: Quality3D;
  /** Edición: todos los objetos visibles (los ocultos al 40 %), sin sombras. */
  edit?: boolean;
}

/** Opacidad de un objeto en estado `"oculto"` en el editor. */
export const HIDDEN_OBJECT_OPACITY = 0.4;

/** La habitación visible: piezas, objetos, luces y malla de colisión. */
export class RoomWorld {
  readonly group = new THREE.Group();
  readonly collision: THREE.Mesh;
  /** Solo muros y estructura (más modelos desconocidos): lo único que frena la cámara del jugador. */
  readonly cameraCollision: THREE.Mesh;
  readonly objects = new Map<string, WorldObjectEntry>();
  readonly pieces = new Map<string, PieceEntry>();
  readonly boxes = new BoxFactory();
  disposed = false;

  private readonly slots = new Set<ModelSlot>();
  private torchPool: THREE.PointLight[] = [];
  private lastTorchFocus: { x: number; y: number } | undefined;
  private lastStates: ObjectStateMap | undefined;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private shadows: boolean;
  private torchLimit: number;
  private readonly edit: boolean;
  private lightingKey = "";

  constructor(
    private model: RuntimeModel,
    private room: RuntimeSubRoom,
    readonly assets: AssetContext,
    navInput: NavInput,
    states: ObjectStateMap,
    options: RoomWorldOptions = {},
  ) {
    const quality = options.quality ?? "high";
    this.edit = options.edit ?? false;
    this.shadows = quality === "high" && !this.edit;
    this.torchLimit = quality === "high" ? MAX_TORCH_LIGHTS : LOW_TORCH_LIGHTS;
    for (const piece of room.pieces) this.addPiece(piece);
    for (const object of room.objects) this.addObject(object, states);

    this.collision = createCollisionMesh(navInput);
    this.group.add(this.collision);
    this.cameraCollision = createCollisionMesh(this.buildCameraCollisionInput());
    this.group.add(this.cameraCollision);

    const sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun = sun;
    this.frameSunShadow(room);
    this.hemisphere = new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 0.6);
    this.group.add(sun, sun.target, this.hemisphere);
    this.applyLighting(states);
  }

  private isCameraBlocking(modelId: string): boolean {
    return CAMERA_BLOCKING_KINDS.has(resolveVisual(modelId, this.assets).kind);
  }

  private buildCameraCollisionInput(): NavInput {
    return buildNavInputFromParts({
      pieces: this.room.pieces.filter((piece) => this.isCameraBlocking(piece.model)),
      objects: [],
      catalog: this.assets.catalog,
      customModels: this.model.customModels,
    });
  }

  /**
   * Hace translúcidos (opacidad 0,3, transición de 0,2 s) los objetos y piezas que no frenan la
   * cámara y quedan entre `from` (objetivo) y `to` (cámara); los vuelve a opacar al dejar de estorbar.
   */
  updateOcclusion(dt: number, from: THREE.Vector3, to: THREE.Vector3 | undefined): void {
    const ray = new THREE.Ray();
    let length = 0;
    if (to) {
      length = from.distanceTo(to);
      ray.set(from, to.clone().sub(from).normalize());
      ray.origin.addScaledVector(ray.direction, OCCLUSION_RADIUS); // lo que toca al personaje no cuenta
      length -= OCCLUSION_RADIUS;
    }
    const step = (dt * (1 - OCCLUDED_OPACITY)) / OCCLUSION_FADE_S;
    const hitPoint = new THREE.Vector3();
    const test = (slot: ModelSlot, blocking: boolean) => {
      let blocks = false;
      if (length > 0 && !blocking && slot.holder.visible) {
        const box = slot.bounds();
        if (!box.isEmpty()) {
          box.expandByScalar(OCCLUSION_RADIUS);
          const hit = ray.intersectBox(box, hitPoint);
          blocks = hit !== null && ray.origin.distanceTo(hit) <= length;
        }
      }
      const current = slot.occlusion;
      const goal = blocks ? OCCLUDED_OPACITY : 1;
      if (current === goal) return;
      slot.setOcclusionFade(
        goal < current ? Math.max(goal, current - step) : Math.min(goal, current + step),
      );
    };
    for (const { piece, slot } of this.pieces.values()) {
      const kind = resolveVisual(piece.model, this.assets).kind;
      test(slot, kind === "suelo" || this.isCameraBlocking(piece.model));
    }
    for (const { slot } of this.objects.values()) test(slot, false);
  }

  private addPiece(piece: Piece3D): void {
    const slot = new ModelSlot(this, piece);
    slot.holder.userData.editTarget = { kind: "piece", id: piece.id };
    slot.set(piece.model);
    this.slots.add(slot);
    this.pieces.set(piece.id, { piece, slot });
    this.group.add(slot.holder);
  }

  private addObject(object: RuntimeObject, states: ObjectStateMap): void {
    if (!object.transform) return;
    const slot = new ModelSlot(this, object.transform);
    slot.holder.userData.editTarget = { kind: "object", id: object.id };
    const state = currentObjectState(states, object);
    slot.set(resolveObjectStateSprite(object, state));
    this.applyObjectVisibility(slot, state);
    this.objects.set(object.id, { object, slot, state });
    this.slots.add(slot);
    this.group.add(slot.holder);
  }

  /** Juego: `"oculto"` no se ve. Edición: se ve al 40 %. */
  private applyObjectVisibility(slot: ModelSlot, state: string): void {
    if (this.edit) {
      slot.holder.visible = true;
      slot.setOpacity(state === "oculto" ? HIDDEN_OBJECT_OPACITY : 1);
    } else {
      slot.holder.visible = state !== "oculto";
    }
  }

  /** Ambiente y antorchas de la habitación actual (se reconstruyen si cambia la lista de luces). */
  private applyLighting(states: ObjectStateMap): void {
    const room = this.room;
    this.lightingKey = JSON.stringify(room.lighting);
    this.hemisphere.color.set(0xdfe8ff);
    this.hemisphere.intensity = 0.6;
    const ambient = room.lighting.find((l) => l.type === "ambient");
    if (ambient && ambient.type === "ambient") {
      this.hemisphere.color.set(ambient.color);
      this.hemisphere.intensity = ambient.intensity;
    }
    for (const light of this.torchPool) {
      this.group.remove(light);
      light.dispose();
    }
    this.torchPool = [];
    const torchCount = room.lighting.filter((l) => l.type === "torch").length;
    for (let i = 0; i < Math.min(MAX_TORCH_LIGHTS, torchCount); i++) {
      const light = new THREE.PointLight(TORCH_COLOR, 0, 6);
      this.torchPool.push(light);
      this.group.add(light);
    }
    this.applyTorchLimit();
    this.updateTorches(this.lastTorchFocus, states);
  }

  /**
   * Edición: sustituye el modelo y repinta SOLO lo que cambió (por id). `hold` devuelve `true`
   * para los elementos (`"piece:<id>"`, `"object:<id>"`) cuya posición no se toca (arrastre en curso).
   */
  sync(
    model: RuntimeModel,
    room: RuntimeSubRoom,
    states: ObjectStateMap,
    hold: (key: string) => boolean = () => false,
  ): void {
    const resized = room.width !== this.room.width || room.height !== this.room.height;
    this.model = model;
    this.room = room;
    this.lastStates = states;
    // Modelos propios añadidos o cambiados desde que se creó el mundo.
    this.assets.customModels = model.customModels;

    const livePieces = new Set<string>();
    for (const piece of room.pieces) {
      livePieces.add(piece.id);
      const entry = this.pieces.get(piece.id);
      if (!entry) {
        this.addPiece(piece);
        continue;
      }
      entry.piece = piece;
      if (entry.slot.modelId !== piece.model) entry.slot.set(piece.model);
      if (!hold(`piece:${piece.id}`)) entry.slot.place(piece);
    }
    for (const [id, entry] of [...this.pieces]) {
      if (livePieces.has(id)) continue;
      this.removeSlot(entry.slot);
      this.pieces.delete(id);
    }

    const liveObjects = new Set<string>();
    for (const object of room.objects) {
      if (!object.transform) continue;
      liveObjects.add(object.id);
      const entry = this.objects.get(object.id);
      if (!entry) {
        this.addObject(object, states);
        continue;
      }
      const state = currentObjectState(states, object);
      const sprite = resolveObjectStateSprite(object, state);
      entry.object = object;
      entry.state = state;
      if (entry.slot.modelId !== sprite) entry.slot.set(sprite);
      this.applyObjectVisibility(entry.slot, state);
      if (!hold(`object:${object.id}`)) entry.slot.place(object.transform);
    }
    for (const [id, entry] of [...this.objects]) {
      if (liveObjects.has(id)) continue;
      this.removeSlot(entry.slot);
      this.objects.delete(id);
    }

    if (resized) this.frameSunShadow(room);
    if (JSON.stringify(room.lighting) !== this.lightingKey) this.applyLighting(states);
  }

  /** Repinta los modelos propios cuya URL (o definición) ha cambiado; los demás no se tocan. */
  refreshCustomModels(): void {
    for (const slot of this.slots) slot.refreshVisual();
  }

  private removeSlot(slot: ModelSlot): void {
    slot.dispose();
    this.slots.delete(slot);
    this.group.remove(slot.holder);
  }

  /** La cámara de sombras cubre la caja de la habitación; la luz mantiene su dirección. */
  private frameSunShadow(room: RuntimeSubRoom): void {
    const center = new THREE.Vector3(room.width / 2, SHADOW_BOX_HEIGHT / 2, room.height / 2);
    const radius = Math.hypot(room.width, room.height, SHADOW_BOX_HEIGHT) / 2 + 0.5;
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(SUN_DIRECTION, radius + 2);
    const shadow = this.sun.shadow;
    shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    shadow.camera.left = -radius;
    shadow.camera.right = radius;
    shadow.camera.top = radius;
    shadow.camera.bottom = -radius;
    shadow.camera.near = 0.1;
    shadow.camera.far = 2 * radius + 4;
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -0.0005;
    shadow.normalBias = 0.02;
    this.sun.castShadow = this.shadows;
  }

  /** Piezas y objetos reciben y proyectan sombra (con calidad alta). */
  markShadows(root: THREE.Object3D): void {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.outline) return;
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = this.shadows;
    });
  }

  /** Cambia la calidad en caliente: sombras y número de antorchas simultáneas. */
  setQuality(quality: Quality3D): void {
    this.shadows = quality === "high" && !this.edit;
    this.torchLimit = quality === "high" ? MAX_TORCH_LIGHTS : LOW_TORCH_LIGHTS;
    this.sun.castShadow = this.shadows;
    for (const slot of this.slots) this.markShadows(slot.holder);
    this.applyTorchLimit();
    this.updateTorches(undefined, this.lastStates ?? {}, true);
  }

  private applyTorchLimit(): void {
    this.torchPool.forEach((light, i) => {
      light.visible = i < this.torchLimit;
    });
  }

  /** Cambia el estado de un objeto: sustituye el modelo y, si hay clip de transición, lo reproduce. */
  setObjectState(objectId: string, state: string): void {
    const entry = this.objects.get(objectId);
    if (!entry) return;
    entry.state = state;
    this.applyObjectVisibility(entry.slot, state);
    const animation = resolveObjectStateAnimation(entry.object, state);
    entry.slot.set(resolveObjectStateSprite(entry.object, state), animation);
  }

  /** Objetos que ahora mismo responden al clic: interactables y no ocultos. */
  interactiveRoots(): THREE.Object3D[] {
    const roots: THREE.Object3D[] = [];
    for (const [id, entry] of this.objects) {
      if (entry.object.interactable && entry.state !== "oculto") {
        entry.slot.holder.userData.objectId = id;
        roots.push(entry.slot.holder);
      }
    }
    return roots;
  }

  /**
   * Antorchas: las encendidas más cercanas a `focus` (como mucho `MAX_TORCH_LIGHTS`).
   * Con `focus` ausente usa el último conocido. Devuelve `true` si recalculó.
   */
  updateTorches(
    focus: { x: number; y: number } | undefined,
    states: ObjectStateMap,
    force = true,
  ): boolean {
    if (this.torchPool.length === 0) return false;
    this.lastStates = states;
    if (
      !force &&
      focus &&
      this.lastTorchFocus &&
      Math.hypot(focus.x - this.lastTorchFocus.x, focus.y - this.lastTorchFocus.y) <=
        TORCH_RECALC_DISTANCE
    ) {
      return false;
    }
    if (focus) this.lastTorchFocus = { ...focus };
    const center = this.lastTorchFocus ?? { x: 0, y: 0 };
    const torches = this.room.lighting.filter((l) => l.type === "torch");
    const resolved = resolveTorchLights(this.model, this.room.id, states);
    const lit = resolved
      .map((t, i) => ({ t, h: torches[i]?.type === "torch" ? (torches[i].h ?? 1.6) : 1.6 }))
      .filter(({ t }) => t.lit)
      .sort(
        (a, b) =>
          Math.hypot(a.t.x - center.x, a.t.y - center.y) -
          Math.hypot(b.t.x - center.x, b.t.y - center.y),
      );
    this.torchPool.forEach((light, i) => {
      const torch = i < this.torchLimit ? lit[i] : undefined;
      if (!torch) {
        light.intensity = 0;
        return;
      }
      light.intensity = 2;
      light.position.set(torch.t.x, torch.h, torch.t.y);
    });
    return true;
  }

  /** Número de antorchas encendidas ahora mismo (`intensity > 0`). */
  get activeTorchCount(): number {
    return this.torchPool.filter((l) => l.intensity > 0).length;
  }

  update(dt: number): void {
    for (const slot of this.slots) slot.mixer?.update(dt);
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) slot.dispose();
    this.collision.geometry.dispose();
    (this.collision.material as THREE.Material).dispose();
    this.cameraCollision.geometry.dispose();
    (this.cameraCollision.material as THREE.Material).dispose();
    this.boxes.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}
