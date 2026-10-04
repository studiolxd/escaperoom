import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { createRoomNav, initNav3D, type NavInput } from "@escaperoom/nav3d";
import type { RuntimeSubRoom } from "../loader";
import { ModelSlot, type RoomWorld } from "./world";

/** Lo que hay bajo el puntero en el modo edición (specs/27 §8). */
export type EditTarget3D =
  | { kind: "piece"; id: string }
  | { kind: "object"; id: string }
  | { kind: "spawn"; id: string }
  /** `index` es la posición de la antorcha dentro de `room.lighting`. */
  | { kind: "torch"; index: number }
  | { kind: "none" };

export interface EditPointer3D {
  type: "move" | "down" | "up" | "click";
  /** Punto del plano de trabajo bajo el puntero (coordenadas lógicas), o `null` si el rayo no lo corta. */
  point: { x: number; y: number; h: number } | null;
  /** Lo que hay bajo el puntero (lo más cercano a la cámara). */
  target: EditTarget3D;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type GizmoMode = "translate" | "rotate" | "scale";

export interface TransformChange3D {
  /** Nunca `"none"`. */
  target: EditTarget3D;
  x: number;
  y: number;
  h: number;
  yaw: number;
  scale: number;
}

/** Incrementos respecto al inicio del gesto (`scale` es un factor: 1 = sin cambio). */
export interface GizmoDelta {
  dx: number;
  dy: number;
  dh: number;
  dyaw: number;
  dscale: number;
}

export const EDIT_COLORS = {
  grid: 0x64748b,
  spawn: 0x22c55e,
  torch: 0xf59e0b,
  selection: 0x38bdf8,
  navmesh: 0x22c55e,
} as const;

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;
export const GRID_OFFSET = 0.01;
export const NAVMESH_OFFSET = 0.03;
export const NAVMESH_DEBOUNCE_MS = 300;
const SPAWN_RADIUS = 0.3;
const TORCH_RADIUS = 0.12;
const DEFAULT_TORCH_H = 1.6;
const GHOST_OPACITY = 0.5;
const EPS = 1e-9;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const round9 = (v: number): number => Math.round(v * 1e9) / 1e9;

/** `[0, 360)`. */
export function normalizeYaw(deg: number): number {
  const v = ((deg % 360) + 360) % 360;
  return v >= 360 ? 0 : v;
}

/** Redondea al múltiplo de `step` más cercano (0 = libre). */
export function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

interface Pose {
  x: number;
  y: number;
  h: number;
  yaw: number;
  scale: number;
}

interface Session {
  items: { target: EditTarget3D; base: Pose }[];
  pivot: { x: number; y: number };
}

interface Marker {
  target: EditTarget3D;
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  baseColor: number;
}

const targetKey = (t: EditTarget3D): string =>
  t.kind === "piece" || t.kind === "object" || t.kind === "spawn"
    ? `${t.kind}:${t.id}`
    : t.kind === "torch"
      ? `torch:${t.index}`
      : "none";

const sameTarget = (a: EditTarget3D, b: EditTarget3D): boolean => targetKey(a) === targetKey(b);

/**
 * Capa de edición de `RoomRuntime3D` (specs/27 §8): rejilla, marcadores, selección, fantasma,
 * gizmos y navmesh visible. No escribe en el documento: solo emite eventos.
 */
export class EditLayer {
  readonly group = new THREE.Group();

  private world: RoomWorld | undefined;
  private room: RuntimeSubRoom | undefined;
  private workHeight = 0;

  private grid: THREE.Group | undefined;
  private gridKey = "";
  private markers: Marker[] = [];
  private markersKey = "";
  private selection: EditTarget3D[] = [];
  private readonly boxes = new Map<string, THREE.Box3Helper>();
  private readonly selectionOutline = new THREE.MeshBasicMaterial({
    color: EDIT_COLORS.selection,
    side: THREE.BackSide,
  });
  private ghostState:
    | { model: string; x: number; y: number; h: number; yaw: number; scale?: number | undefined }
    | undefined;
  private ghost: ModelSlot | undefined;

  private gizmoMode: GizmoMode | null = null;
  private snap = { move: 0, yaw: 0 };
  private controls: TransformControls | undefined;
  private readonly pivot = new THREE.Object3D();
  private session: Session | undefined;
  private lastEmitted = "";
  private lastDelta: GizmoDelta = { dx: 0, dy: 0, dh: 0, dyaw: 0, dscale: 1 };
  /** Posición del pivote al empezar el arrastre de un gizmo. */
  private pivotStart = new THREE.Vector3();
  /** El gesto en curso ha cambiado algo (un clic sobre el gizmo sin arrastrar no emite nada). */
  private changed = false;
  private readonly transformHandlers = new Set<
    (changes: readonly TransformChange3D[], final: boolean) => void
  >();

  private navVisible = false;
  private navOverlay: THREE.Group | undefined;
  private navTimer: ReturnType<typeof setTimeout> | undefined;
  private navPending: Promise<void> | undefined;
  private navToken = 0;
  private disposed = false;

  constructor(private readonly buildNavInput: () => NavInput | undefined) {
    this.group.add(this.pivot);
  }

  // ------------------------------------------------------------ enlace con el mundo

  /** Enlaza con un mundo recién construido: reconstruye todo lo visual de edición. */
  bind(world: RoomWorld, room: RuntimeSubRoom): void {
    this.endSession();
    this.disposeGhost();
    this.world = world;
    this.room = room;
    this.gridKey = "";
    this.markersKey = "";
    this.refresh(room);
    if (this.ghostState) this.setGhost(this.ghostState);
    if (this.navVisible) this.scheduleNavmesh(true);
  }

  /** Tras un `setModel` incremental: rejilla y marcadores si cambiaron, selección repintada. */
  refresh(room: RuntimeSubRoom): void {
    this.room = room;
    const gridKey = `${room.width}x${room.height}@${this.workHeight}`;
    if (gridKey !== this.gridKey) {
      this.gridKey = gridKey;
      this.rebuildGrid(room);
    }
    const markersKey = JSON.stringify([room.spawns, room.lighting]);
    if (markersKey !== this.markersKey) {
      this.markersKey = markersKey;
      this.rebuildMarkers(room);
    }
    this.paintSelection();
    this.refreshGizmo();
    if (this.navVisible) this.scheduleNavmesh(false);
  }

  setWorkHeight(h: number): void {
    this.workHeight = h;
    if (this.room) this.refresh(this.room);
  }

  // ------------------------------------------------------------ rejilla y marcadores

  private rebuildGrid(room: RuntimeSubRoom): void {
    if (this.grid) {
      this.disposeObject(this.grid);
      this.group.remove(this.grid);
    }
    const cols = room.width;
    const rows = room.height;
    const lines: number[] = [];
    for (let x = 0; x <= cols; x++) lines.push(x, 0, 0, x, 0, rows);
    for (let z = 0; z <= rows; z++) lines.push(0, 0, z, cols, 0, z);
    const material = new THREE.LineBasicMaterial({
      color: EDIT_COLORS.grid,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    const grid = new THREE.Group();
    grid.add(new THREE.LineSegments(geometry, material));
    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, cols, 0, 0, cols, 0, rows, 0, 0, rows], 3),
    );
    grid.add(new THREE.LineLoop(outlineGeometry, material));
    grid.position.y = this.workHeight + GRID_OFFSET;
    this.grid = grid;
    this.group.add(grid);
  }

  private rebuildMarkers(room: RuntimeSubRoom): void {
    for (const marker of this.markers) {
      this.disposeObject(marker.group);
      this.group.remove(marker.group);
    }
    this.markers = [];
    for (const spawn of room.spawns) {
      const material = new THREE.MeshBasicMaterial({ color: EDIT_COLORS.spawn });
      const group = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(SPAWN_RADIUS, SPAWN_RADIUS, 0.03, 24), material);
      disc.position.y = 0.015;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 12), material);
      arrow.rotation.x = Math.PI / 2; // el cono apunta a +Z: yaw 0 = +y lógico
      arrow.position.set(0, 0.1, SPAWN_RADIUS);
      group.add(disc, arrow);
      group.position.set(spawn.x, spawn.h, spawn.y);
      group.rotation.y = (spawn.yaw * Math.PI) / 180;
      const target: EditTarget3D = { kind: "spawn", id: spawn.id };
      group.userData.editTarget = target;
      this.markers.push({ target, group, material, baseColor: EDIT_COLORS.spawn });
      this.group.add(group);
    }
    room.lighting.forEach((light, index) => {
      if (light.type !== "torch") return;
      const material = new THREE.MeshBasicMaterial({ color: EDIT_COLORS.torch });
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.SphereGeometry(TORCH_RADIUS, 16, 12), material));
      group.position.set(light.x, light.h ?? DEFAULT_TORCH_H, light.y);
      const target: EditTarget3D = { kind: "torch", index };
      group.userData.editTarget = target;
      this.markers.push({ target, group, material, baseColor: EDIT_COLORS.torch });
      this.group.add(group);
    });
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
    });
  }

  // ------------------------------------------------------------ picking

  /** Elementos que pueden quedar bajo el puntero (piezas, objetos y marcadores). */
  private pickRoots(): THREE.Object3D[] {
    const roots: THREE.Object3D[] = [];
    for (const { slot } of this.world?.pieces.values() ?? []) roots.push(slot.holder);
    for (const { slot } of this.world?.objects.values() ?? []) roots.push(slot.holder);
    for (const marker of this.markers) roots.push(marker.group);
    return roots;
  }

  /** Lo más cercano a la cámara bajo el rayo (el fantasma y la selección visual no cuentan). */
  pick(raycaster: THREE.Raycaster): EditTarget3D {
    const hit = raycaster.intersectObjects(this.pickRoots(), true)[0];
    let node: THREE.Object3D | null = hit?.object ?? null;
    while (node) {
      const target = node.userData.editTarget as EditTarget3D | undefined;
      if (target) return target;
      node = node.parent;
    }
    return { kind: "none" };
  }

  /** Punto del plano de trabajo bajo el rayo, en coordenadas lógicas. */
  pickPoint(raycaster: THREE.Raycaster): { x: number; y: number; h: number } | null {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.workHeight);
    const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return point ? { x: point.x, y: point.z, h: this.workHeight } : null;
  }

  // ------------------------------------------------------------ selección y fantasma

  setSelection(targets: readonly EditTarget3D[]): void {
    this.selection = targets.filter((t) => t.kind !== "none");
    this.endSession();
    this.paintSelection();
    this.refreshGizmo();
  }

  private paintSelection(): void {
    const selected = new Set(this.selection.map(targetKey));
    for (const [id, { slot }] of this.world?.pieces ?? []) {
      slot.setEditOutline(selected.has(`piece:${id}`) ? this.selectionOutline : undefined);
    }
    for (const [id, { slot }] of this.world?.objects ?? []) {
      slot.setEditOutline(selected.has(`object:${id}`) ? this.selectionOutline : undefined);
    }
    for (const marker of this.markers) {
      marker.material.color.set(
        selected.has(targetKey(marker.target)) ? EDIT_COLORS.selection : marker.baseColor,
      );
    }
    for (const [key, helper] of this.boxes) {
      if (selected.has(key) && this.object3dOf(parseKey(key))) continue;
      this.group.remove(helper);
      helper.dispose();
      this.boxes.delete(key);
    }
    for (const target of this.selection) {
      const key = targetKey(target);
      if (this.boxes.has(key) || !this.object3dOf(target)) continue;
      const helper = new THREE.Box3Helper(new THREE.Box3(), EDIT_COLORS.selection);
      this.boxes.set(key, helper);
      this.group.add(helper);
    }
  }

  setGhost(
    ghost: { model: string; x: number; y: number; h: number; yaw: number; scale?: number } | null,
  ): void {
    this.ghostState = ghost ?? undefined;
    if (!ghost || !this.world) {
      this.disposeGhost();
      return;
    }
    if (!this.ghost) {
      this.ghost = new ModelSlot(this.world, ghost);
      this.group.add(this.ghost.holder);
      this.ghost.setOpacity(GHOST_OPACITY);
    }
    this.ghost.place(ghost);
    if (this.ghost.modelId !== ghost.model) this.ghost.set(ghost.model);
  }

  private disposeGhost(): void {
    if (!this.ghost) return;
    this.group.remove(this.ghost.holder);
    this.ghost.dispose();
    this.ghost = undefined;
  }

  // ------------------------------------------------------------ poses de los elementos

  private object3dOf(target: EditTarget3D): THREE.Object3D | undefined {
    switch (target.kind) {
      case "piece":
        return this.world?.pieces.get(target.id)?.slot.holder;
      case "object":
        return this.world?.objects.get(target.id)?.slot.holder;
      case "spawn":
      case "torch":
        return this.markers.find((m) => sameTarget(m.target, target))?.group;
      default:
        return undefined;
    }
  }

  private poseOf(target: EditTarget3D): Pose | undefined {
    const o = this.object3dOf(target);
    if (!o) return undefined;
    const hasYaw = target.kind !== "torch";
    const hasScale = target.kind === "piece" || target.kind === "object";
    return {
      x: o.position.x,
      y: o.position.z,
      h: o.position.y,
      yaw: hasYaw ? normalizeYaw(round9((o.rotation.y * 180) / Math.PI)) : 0,
      scale: hasScale ? o.scale.x : 1,
    };
  }

  private writePose(target: EditTarget3D, pose: Pose): void {
    const o = this.object3dOf(target);
    if (!o) return;
    o.position.set(pose.x, pose.h, pose.y);
    if (target.kind !== "torch") o.rotation.y = (pose.yaw * Math.PI) / 180;
    if (target.kind === "piece" || target.kind === "object") o.scale.setScalar(pose.scale);
  }

  /** `true` si el elemento se está arrastrando ahora mismo (no hay que pisarlo con `setModel`). */
  isHeld(key: string): boolean {
    return !!this.session?.items.some((i) => targetKey(i.target) === key);
  }

  /** Centro de la selección en coordenadas Three, o `undefined` si no hay nada seleccionado. */
  selectionCenter(): THREE.Vector3 | undefined {
    const box = new THREE.Box3();
    let any = false;
    for (const target of this.selection) {
      const o = this.object3dOf(target);
      if (!o) continue;
      const slot = this.slotOf(target);
      if (slot) {
        const b = slot.bounds();
        if (!b.isEmpty()) {
          box.union(b);
          any = true;
          continue;
        }
      }
      box.expandByPoint(o.position);
      any = true;
    }
    return any ? box.getCenter(new THREE.Vector3()) : undefined;
  }

  private slotOf(target: EditTarget3D): ModelSlot | undefined {
    if (target.kind === "piece") return this.world?.pieces.get(target.id)?.slot;
    if (target.kind === "object") return this.world?.objects.get(target.id)?.slot;
    return undefined;
  }

  private selectedExisting(): EditTarget3D[] {
    return this.selection.filter((t) => this.object3dOf(t));
  }

  // ------------------------------------------------------------ gizmos

  /** Crea los `TransformControls` (solo con renderer; en headless no hay gizmo visual). */
  attachGizmo(camera: THREE.Camera, domElement: HTMLElement): void {
    const controls = new TransformControls(camera, domElement);
    controls.setSpace("world");
    controls.addEventListener("dragging-changed", (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      if (dragging) this.beginSession();
      else this.finishDrag();
    });
    controls.addEventListener("objectChange", () => this.onGizmoChange());
    this.controls = controls;
    this.group.add(controls.getHelper());
    this.refreshGizmo();
  }

  /** `true` mientras un gizmo tiene la pulsación (o hay un gesto en curso por `applyGizmoDelta`). */
  get gizmoDragging(): boolean {
    return this.controls?.dragging === true;
  }

  setGizmoMode(mode: GizmoMode | null): void {
    this.gizmoMode = mode;
    this.refreshGizmo();
  }

  setSnap(snap: { move: number; yaw: number }): void {
    this.snap = { move: Math.max(0, snap.move), yaw: Math.max(0, snap.yaw) };
  }

  onTransform(handler: (changes: readonly TransformChange3D[], final: boolean) => void): () => void {
    this.transformHandlers.add(handler);
    return () => {
      this.transformHandlers.delete(handler);
    };
  }

  /** Elementos de la selección a los que el modo de gizmo actual puede aplicarse. */
  private gizmoTargets(): EditTarget3D[] {
    const mode = this.gizmoMode;
    if (!mode) return [];
    return this.selectedExisting().filter((t) => {
      if (mode === "translate") return true;
      if (mode === "rotate") return t.kind !== "torch";
      return t.kind === "piece" || t.kind === "object";
    });
  }

  private refreshGizmo(): void {
    const controls = this.controls;
    if (!controls || controls.dragging) return;
    const mode = this.gizmoMode;
    const targets = this.gizmoTargets();
    const center = this.selectionCenter();
    if (!mode || targets.length === 0 || !center) {
      controls.detach();
      controls.getHelper().visible = false;
      return;
    }
    controls.setMode(mode);
    controls.showX = mode === "translate";
    controls.showZ = mode === "translate";
    controls.showY = true;
    this.pivot.position.copy(center);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
    controls.attach(this.pivot);
    controls.getHelper().visible = true;
  }

  private beginSession(): void {
    const items: Session["items"] = [];
    for (const target of this.selectedExisting()) {
      const base = this.poseOf(target);
      if (base) items.push({ target, base });
    }
    if (items.length === 0) {
      this.session = undefined;
      return;
    }
    const pivot = {
      x: items.reduce((s, i) => s + i.base.x, 0) / items.length,
      y: items.reduce((s, i) => s + i.base.y, 0) / items.length,
    };
    this.session = { items, pivot };
    this.lastEmitted = "";
    this.changed = false;
    this.lastDelta = { dx: 0, dy: 0, dh: 0, dyaw: 0, dscale: 1 };
    this.pivotStart.copy(this.pivot.position);
    this.pivot.quaternion.identity();
    this.pivot.scale.set(1, 1, 1);
  }

  private endSession(): void {
    this.session = undefined;
    this.lastEmitted = "";
  }

  private onGizmoChange(): void {
    if (!this.session) return;
    const mode = this.gizmoMode;
    const p = this.pivotStart;
    const delta: GizmoDelta = { dx: 0, dy: 0, dh: 0, dyaw: 0, dscale: 1 };
    if (mode === "translate") {
      delta.dx = this.pivot.position.x - p.x;
      delta.dy = this.pivot.position.z - p.z;
      delta.dh = this.pivot.position.y - p.y;
    } else if (mode === "rotate") {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.pivot.quaternion);
      delta.dyaw = (Math.atan2(forward.x, forward.z) * 180) / Math.PI;
    } else if (mode === "scale") {
      delta.dscale = Math.max(this.pivot.scale.y, EPS);
    }
    const applied = this.applyDelta(delta, false);
    // El gizmo refleja el imán.
    if (mode === "translate") {
      this.pivot.position.set(p.x + applied.dx, p.y + applied.dh, p.z + applied.dy);
    } else if (mode === "rotate") {
      this.pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (applied.dyaw * Math.PI) / 180);
    }
  }

  private finishDrag(): void {
    if (this.session && this.changed) this.emit(this.computeChanges(this.lastDelta), true);
    this.endSession();
    this.refreshGizmo();
  }

  /**
   * Aplica un gesto de gizmo (la misma función que usa el arrastre). Los incrementos son
   * respecto al inicio del gesto, que empieza solo en la primera llamada y acaba con `final`.
   * El imán se aplica al incremento (así lo ya alineado a 0,5 m sigue alineado). Devuelve los
   * incrementos efectivos.
   */
  applyGizmoDelta(delta: Partial<GizmoDelta>, final: boolean): GizmoDelta {
    const full: GizmoDelta = { dx: 0, dy: 0, dh: 0, dyaw: 0, dscale: 1, ...delta };
    if (!this.session) this.beginSession();
    const applied = this.applyDelta(full, final);
    if (final) {
      this.endSession();
      this.refreshGizmo();
    }
    return applied;
  }

  private applyDelta(delta: GizmoDelta, final: boolean): GizmoDelta {
    const session = this.session;
    const room = this.room;
    if (!session || !room) return delta;
    const applied: GizmoDelta = {
      dx: snapTo(delta.dx, this.snap.move),
      dy: snapTo(delta.dy, this.snap.move),
      dh: snapTo(delta.dh, this.snap.move),
      dyaw: snapTo(delta.dyaw, this.snap.yaw),
      dscale: delta.dscale,
    };
    this.lastDelta = applied;
    this.changed = true;
    const changes = this.computeChanges(applied);
    for (const change of changes) {
      this.writePose(change.target, change);
    }
    const key = JSON.stringify(changes);
    if (final || key !== this.lastEmitted) {
      this.lastEmitted = key;
      this.emit(changes, final);
    }
    return applied;
  }

  private computeChanges(delta: GizmoDelta): TransformChange3D[] {
    const session = this.session;
    const room = this.room;
    if (!session || !room) return [];
    const theta = (delta.dyaw * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    return session.items.map(({ target, base }) => {
      // Giro rígido alrededor del pivote, con el mismo sentido que `rotation.y` de Three.
      const ox = base.x - session.pivot.x;
      const oz = base.y - session.pivot.y;
      const x = session.pivot.x + ox * cos + oz * sin + delta.dx;
      const y = session.pivot.y - ox * sin + oz * cos + delta.dy;
      const hasYaw = target.kind !== "torch";
      const hasScale = target.kind === "piece" || target.kind === "object";
      return {
        target,
        x: clamp(x, 0, room.width),
        y: clamp(y, 0, room.height),
        h: Math.max(0, base.h + delta.dh),
        yaw: hasYaw ? normalizeYaw(base.yaw + delta.dyaw) : 0,
        scale: hasScale ? clamp(base.scale * delta.dscale, MIN_SCALE, MAX_SCALE) : 1,
      };
    });
  }

  private emit(changes: readonly TransformChange3D[], final: boolean): void {
    if (changes.length === 0) return;
    for (const handler of [...this.transformHandlers]) handler(changes, final);
  }

  // ------------------------------------------------------------ navmesh visible

  setNavmeshVisible(visible: boolean): void {
    if (this.navVisible === visible) return;
    this.navVisible = visible;
    if (visible) {
      this.scheduleNavmesh(true);
      return;
    }
    clearTimeout(this.navTimer);
    this.navTimer = undefined;
    this.navToken++;
    this.clearNavOverlay();
  }

  /** Regenera la navmesh: de inmediato (`now`) o tras 300 ms sin más cambios. */
  private scheduleNavmesh(now: boolean): void {
    clearTimeout(this.navTimer);
    this.navTimer = undefined;
    if (now) {
      this.navPending = this.regenerateNavmesh();
      return;
    }
    this.navTimer = setTimeout(() => {
      this.navTimer = undefined;
      this.navPending = this.regenerateNavmesh();
    }, NAVMESH_DEBOUNCE_MS);
  }

  /** Solo tests: ejecuta ya la regeneración pendiente y espera a que termine. */
  async flushNavmesh(): Promise<void> {
    if (this.navTimer !== undefined) {
      clearTimeout(this.navTimer);
      this.navTimer = undefined;
      this.navPending = this.regenerateNavmesh();
    }
    await this.navPending;
  }

  get navmeshOverlay(): THREE.Object3D | undefined {
    return this.navOverlay;
  }

  private async regenerateNavmesh(): Promise<void> {
    const token = ++this.navToken;
    await initNav3D();
    if (this.disposed || token !== this.navToken || !this.navVisible) return;
    const input = this.buildNavInput();
    const nav = input ? createRoomNav(input) : undefined;
    const { positions, indices } = nav?.debugGeometry() ?? {
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
    };
    nav?.destroy();
    this.clearNavOverlay();
    if (indices.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: EDIT_COLORS.navmesh,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const edges = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: EDIT_COLORS.navmesh }),
    );
    const overlay = new THREE.Group();
    overlay.add(fill, edges);
    overlay.position.y = NAVMESH_OFFSET;
    this.navOverlay = overlay;
    this.group.add(overlay);
  }

  private clearNavOverlay(): void {
    if (!this.navOverlay) return;
    this.disposeObject(this.navOverlay);
    this.group.remove(this.navOverlay);
    this.navOverlay = undefined;
  }

  // ------------------------------------------------------------ por fotograma

  update(): void {
    for (const [key, helper] of this.boxes) {
      const target = parseKey(key);
      const slot = this.slotOf(target);
      const o = this.object3dOf(target);
      if (slot) {
        helper.box.copy(slot.bounds());
      } else if (o) {
        helper.box.setFromObject(o);
      }
      helper.visible = !helper.box.isEmpty();
    }
    if (this.controls && !this.controls.dragging) this.syncPivot();
  }

  /** Con el gizmo en reposo, el pivote sigue al centro de la selección. */
  private syncPivot(): void {
    const center = this.selectionCenter();
    if (center) this.pivot.position.copy(center);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.navTimer);
    this.navTimer = undefined;
    this.controls?.dispose();
    this.disposeGhost();
    this.clearNavOverlay();
    if (this.grid) this.disposeObject(this.grid);
    for (const marker of this.markers) this.disposeObject(marker.group);
    for (const helper of this.boxes.values()) helper.dispose();
    this.selectionOutline.dispose();
    this.transformHandlers.clear();
    this.group.clear();
    this.group.removeFromParent();
  }
}

function parseKey(key: string): EditTarget3D {
  const [kind, rest = ""] = key.split(/:(.*)/s);
  if (kind === "torch") return { kind: "torch", index: Number(rest) };
  if (kind === "piece" || kind === "object" || kind === "spawn") return { kind, id: rest };
  return { kind: "none" };
}
