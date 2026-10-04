import * as THREE from "three";
import type { Avatar3DEntry } from "@escaperoom/shared/packs";
import { instantiateModel } from "./assets";
import { toonGradient } from "./toon";
import { turnToward } from "./movement";

/** Constante de tiempo (s) del suavizado de los jugadores remotos. */
export const REMOTE_SMOOTH_TAU = 0.1;
/** Distancia (m) a partir de la cual un remoto salta en vez de interpolar. */
export const REMOTE_SNAP_DISTANCE = 4;
/** Desplazamiento (m) por fotograma a partir del cual un remoto «anda». */
export const REMOTE_MOVE_EPSILON = 0.02;
const CROSSFADE_S = 0.15;

export interface AvatarOptions {
  tint: string;
  /** Entrada del catálogo del personaje y URL de su GLB; sin ellas, maniquí. */
  entry?: Avatar3DEntry | undefined;
  url?: string | undefined;
}

/** Avatar: GLB con clips (`idle`/`walk`/`interact`) o maniquí tintado, más el anillo del jugador. */
export class AvatarView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly ringMesh: THREE.Mesh;
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private mannequinMaterial: THREE.MeshToonMaterial | undefined;
  private readonly owned: { dispose(): void }[] = [];
  private mixer: THREE.AnimationMixer | undefined;
  private actions: Partial<Record<"idle" | "walk" | "interact", THREE.AnimationAction>> = {};
  private clipNames: Avatar3DEntry["clips"] | undefined;
  private current: "idle" | "walk" | undefined;
  private tint: string;
  private loadToken = 0;
  private disposed = false;

  constructor(options: AvatarOptions) {
    this.tint = options.tint;
    this.root.add(this.body);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: this.tint,
      side: THREE.DoubleSide,
    });
    const ringGeometry = new THREE.RingGeometry(0.32, 0.42, 32);
    ringGeometry.rotateX(-Math.PI / 2);
    this.ringMesh = new THREE.Mesh(ringGeometry, this.ringMaterial);
    this.ringMesh.position.y = 0.02;
    this.root.add(this.ringMesh);
    this.owned.push(ringGeometry, this.ringMaterial);
    this.setCharacter(options.entry, options.url);
  }

  /** Cambia de personaje (o vuelve al maniquí con `entry`/`url` ausentes). */
  setCharacter(entry: Avatar3DEntry | undefined, url: string | undefined): void {
    const token = ++this.loadToken;
    this.showMannequin();
    if (!entry || !url) return;
    instantiateModel(url).then(
      (loaded) => {
        if (this.disposed || token !== this.loadToken) return;
        this.clearBody();
        this.body.add(loaded.scene);
        this.mixer = new THREE.AnimationMixer(loaded.scene);
        this.clipNames = entry.clips;
        this.actions = {};
        for (const key of ["idle", "walk", "interact"] as const) {
          const clip = THREE.AnimationClip.findByName(loaded.animations, entry.clips[key]);
          if (!clip) continue;
          const action = this.mixer.clipAction(clip);
          if (key === "interact") {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = false;
          }
          this.actions[key] = action;
        }
        this.current = undefined;
        this.setMoving(false);
      },
      () => {
        /* sin GLB: se queda el maniquí */
      },
    );
  }

  setTint(tint: string): void {
    this.tint = tint;
    this.ringMaterial.color.set(tint);
    this.mannequinMaterial?.color.set(tint);
  }

  /** Pose en el plano lógico `(x, y)` con la altura visual `h` y el giro `yaw` (grados). */
  setPose(x: number, h: number, y: number, yaw: number): void {
    this.root.position.set(x, h, y);
    this.body.rotation.y = (yaw * Math.PI) / 180;
  }

  setMoving(moving: boolean): void {
    const next = moving ? "walk" : "idle";
    if (next === this.current) return;
    const from = this.current ? this.actions[this.current] : undefined;
    const to = this.actions[next];
    this.current = next;
    if (!to) return;
    to.reset().play();
    if (from && from !== to) from.crossFadeTo(to, CROSSFADE_S, false);
    else to.fadeIn(CROSSFADE_S);
  }

  /** Reproduce el clip `interact` una vez (si el GLB lo trae). */
  playInteract(): void {
    const action = this.actions.interact;
    if (!action || !this.mixer) return;
    action.reset().play();
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }

  private showMannequin(): void {
    this.clearBody();
    this.mannequinMaterial = new THREE.MeshToonMaterial({
      color: this.tint,
      gradientMap: toonGradient(),
    });
    const capsuleGeometry = new THREE.CapsuleGeometry(0.3, 1.15);
    capsuleGeometry.translate(0, 0.3 + 0.575, 0);
    const coneGeometry = new THREE.ConeGeometry(0.1, 0.25, 12);
    coneGeometry.rotateX(Math.PI / 2); // la punta mira a +Z (frente del modelo)
    coneGeometry.translate(0, 1.3, 0.42);
    this.body.add(
      new THREE.Mesh(capsuleGeometry, this.mannequinMaterial),
      new THREE.Mesh(coneGeometry, this.mannequinMaterial),
    );
    this.mannequinOwned = [capsuleGeometry, coneGeometry, this.mannequinMaterial];
    this.mixer = undefined;
    this.actions = {};
    this.current = undefined;
  }

  private mannequinOwned: { dispose(): void }[] = [];

  private clearBody(): void {
    this.body.clear();
    for (const o of this.mannequinOwned) o.dispose();
    this.mannequinOwned = [];
    this.mannequinMaterial = undefined;
    this.mixer?.stopAllAction();
    this.mixer = undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.clearBody();
    for (const o of this.owned) o.dispose();
    this.root.removeFromParent();
  }
}

/** Jugador remoto: interpola hacia su último estado sincronizado. */
export class RemoteAvatar {
  readonly view: AvatarView;
  /** Pose lógica pintada (antes de la altura visual). */
  pose = { x: 0, y: 0, h: 0, yaw: 0 };
  private target = { x: 0, y: 0, h: 0, yaw: 0 };
  private placed = false;

  constructor(options: AvatarOptions) {
    this.view = new AvatarView(options);
  }

  setTarget(t: { x: number; y: number; h?: number | undefined; yaw?: number | undefined }): void {
    this.target = { x: t.x, y: t.y, h: t.h ?? 0, yaw: t.yaw ?? 0 };
    if (!this.placed) {
      this.pose = { ...this.target };
      this.placed = true;
    }
  }

  /** Avanza el suavizado; devuelve `true` si se movió más de `REMOTE_MOVE_EPSILON` en este fotograma. */
  step(dt: number): boolean {
    const dist = Math.hypot(
      this.target.x - this.pose.x,
      this.target.y - this.pose.y,
      this.target.h - this.pose.h,
    );
    if (dist > REMOTE_SNAP_DISTANCE) {
      this.pose = { ...this.target };
      return false;
    }
    const k = 1 - Math.exp(-dt / REMOTE_SMOOTH_TAU);
    const before = { ...this.pose };
    this.pose.x += (this.target.x - this.pose.x) * k;
    this.pose.y += (this.target.y - this.pose.y) * k;
    this.pose.h += (this.target.h - this.pose.h) * k;
    const diff = ((((this.target.yaw - this.pose.yaw) % 360) + 540) % 360) - 180;
    this.pose.yaw = turnToward(this.pose.yaw, this.target.yaw, Math.abs(diff) * k);
    return Math.hypot(this.pose.x - before.x, this.pose.y - before.y) > REMOTE_MOVE_EPSILON;
  }
}
