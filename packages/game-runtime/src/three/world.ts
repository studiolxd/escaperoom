import * as THREE from "three";
import type { Models3DCatalog } from "@escaperoom/shared/packs";
import { buildNavInputFromParts, type NavInput } from "@escaperoom/nav3d";
import type { RuntimeModel, RuntimeObject, RuntimeSubRoom } from "../loader";
import {
  resolveObjectStateAnimation,
  resolveObjectStateSprite,
  resolveTorchLights,
  currentObjectState,
  type ObjectStateMap,
} from "../world";
import { BoxFactory, instantiateModel, resolveVisual, type AssetContext } from "./assets";

export const MAX_TORCH_LIGHTS = 8;
/** Movimiento (m) del avatar a partir del cual se recalculan las antorchas más cercanas. */
export const TORCH_RECALC_DISTANCE = 1;
const TORCH_COLOR = 0xffb060;
const OUTLINE_COLOR = 0xffe08a;
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

/** Un modelo colocado (pieza u objeto): caja inmediata y GLB que la sustituye al llegar. */
class ModelSlot {
  readonly holder = new THREE.Group();
  mixer: THREE.AnimationMixer | undefined;
  private content: THREE.Object3D | undefined;
  private token = 0;

  constructor(
    private readonly world: RoomWorld,
    placement: { x: number; y: number; h: number; yaw: number; scale?: number | undefined },
  ) {
    this.holder.position.set(placement.x, placement.h, placement.y);
    this.holder.rotation.y = (placement.yaw * Math.PI) / 180;
    this.holder.scale.setScalar(placement.scale ?? 1);
  }

  set(modelId: string, animation?: string): void {
    const token = ++this.token;
    const visual = resolveVisual(modelId, this.world.assets);
    this.clear();
    this.content = this.world.boxes.create(visual);
    this.holder.add(this.content);
    if (!visual.url) return;
    instantiateModel(visual.url).then(
      (loaded) => {
        if (this.world.disposed || token !== this.token) return;
        this.clear();
        this.content = loaded.scene;
        this.holder.add(loaded.scene);
        this.world.reapplyOutline(this);
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

  private clear(): void {
    this.mixer?.stopAllAction();
    this.mixer = undefined;
    if (this.content) this.holder.remove(this.content);
    this.content = undefined;
  }

  invalidate(): void {
    this.token++;
  }
}

export interface WorldObjectEntry {
  object: RuntimeObject;
  slot: ModelSlot;
  state: string;
}

/** La habitación visible: piezas, objetos, luces y malla de colisión. */
export class RoomWorld {
  readonly group = new THREE.Group();
  readonly collision: THREE.Mesh;
  readonly objects = new Map<string, WorldObjectEntry>();
  readonly boxes = new BoxFactory();
  disposed = false;

  private readonly slots: ModelSlot[] = [];
  private readonly torchPool: THREE.PointLight[] = [];
  private readonly outlineMaterial = new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    side: THREE.BackSide,
  });
  private outlined = new Set<string>();
  private lastTorchFocus: { x: number; y: number } | undefined;
  private readonly hemisphere: THREE.HemisphereLight;

  constructor(
    private readonly model: RuntimeModel,
    private readonly room: RuntimeSubRoom,
    readonly assets: AssetContext,
    navInput: NavInput,
    states: ObjectStateMap,
  ) {
    for (const piece of room.pieces) {
      const slot = new ModelSlot(this, piece);
      slot.set(piece.model);
      this.slots.push(slot);
      this.group.add(slot.holder);
    }
    for (const object of room.objects) {
      if (!object.transform) continue;
      const slot = new ModelSlot(this, object.transform);
      const state = currentObjectState(states, object);
      slot.set(resolveObjectStateSprite(object, state));
      slot.holder.visible = state !== "oculto";
      this.objects.set(object.id, { object, slot, state });
      this.slots.push(slot);
      this.group.add(slot.holder);
    }

    this.collision = createCollisionMesh(navInput);
    this.group.add(this.collision);

    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(-0.7, 0.9, 0.5);
    this.hemisphere = new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 0.6);
    const ambient = room.lighting.find((l) => l.type === "ambient");
    if (ambient && ambient.type === "ambient") {
      this.hemisphere.color.set(ambient.color);
      this.hemisphere.intensity = ambient.intensity;
    }
    this.group.add(sun, sun.target, this.hemisphere);

    const torchCount = room.lighting.filter((l) => l.type === "torch").length;
    for (let i = 0; i < Math.min(MAX_TORCH_LIGHTS, torchCount); i++) {
      const light = new THREE.PointLight(TORCH_COLOR, 0, 6);
      this.torchPool.push(light);
      this.group.add(light);
    }
    this.updateTorches(undefined, states);
  }

  /** Cambia el estado de un objeto: sustituye el modelo y, si hay clip de transición, lo reproduce. */
  setObjectState(objectId: string, state: string): void {
    const entry = this.objects.get(objectId);
    if (!entry) return;
    entry.state = state;
    entry.slot.holder.visible = state !== "oculto";
    const animation = resolveObjectStateAnimation(entry.object, state);
    entry.slot.set(resolveObjectStateSprite(entry.object, state), animation);
    this.reapplyOutline(entry.slot);
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
      const torch = lit[i];
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

  /** Objetos con contorno (resaltado por proximidad o puntero). */
  setOutlined(ids: ReadonlySet<string>): void {
    for (const id of this.outlined) {
      if (!ids.has(id)) this.clearOutline(id);
    }
    for (const id of ids) {
      if (!this.outlined.has(id)) this.addOutline(id);
    }
    this.outlined = new Set(ids);
  }

  reapplyOutline(slot: ModelSlot): void {
    for (const [id, entry] of this.objects) {
      if (entry.slot === slot && this.outlined.has(id)) this.addOutline(id);
    }
  }

  private addOutline(id: string): void {
    const entry = this.objects.get(id);
    if (!entry) return;
    this.clearOutline(id);
    for (const mesh of entry.slot.meshes()) {
      const outline = new THREE.Mesh(mesh.geometry, this.outlineMaterial);
      outline.userData.outline = true;
      outline.scale.setScalar(OUTLINE_SCALE);
      mesh.add(outline);
    }
  }

  private clearOutline(id: string): void {
    const entry = this.objects.get(id);
    if (!entry) return;
    entry.slot.holder.traverse((node) => {
      for (const child of [...node.children]) {
        if (child.userData.outline) node.remove(child);
      }
    });
  }

  update(dt: number): void {
    for (const slot of this.slots) slot.mixer?.update(dt);
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) slot.invalidate();
    this.collision.geometry.dispose();
    (this.collision.material as THREE.Material).dispose();
    this.outlineMaterial.dispose();
    this.boxes.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}
