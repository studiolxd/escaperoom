import * as THREE from "three";

export const CAMERA = {
  minDistance: 2,
  maxDistance: 8,
  startDistance: 5,
  minPolarDeg: 10,
  maxPolarDeg: 75,
  startPolarDeg: 55, // 0° = horizontal, 90° = cenital
  rotateSpeedDegPerPx: 0.3,
  zoomStep: 0.5,
  collisionMargin: 0.2,
  fovDeg: 50,
} as const;

/** Altura (m) sobre la posición visual del avatar a la que mira la cámara. */
export const CAMERA_TARGET_HEIGHT = 1.2;
/** Constante de tiempo (s) del seguimiento del objetivo. */
export const CAMERA_FOLLOW_TAU = 0.08;
/** Distancia mínima efectiva (m) tras acortarla por colisión. */
export const CAMERA_MIN_EFFECTIVE = 0.5;

export interface OrbitState {
  /** Grados, [0, 360). La cámara queda del lado `(sin az, cos az)` del objetivo (plano x–z de Three). */
  azimuth: number;
  /** Grados: 0 = horizontal, 90 = cenital. */
  polar: number;
  distance: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;

export function initialOrbit(yawDeg = 0): OrbitState {
  return {
    azimuth: normalizeDeg(yawDeg + 180),
    polar: CAMERA.startPolarDeg,
    distance: CAMERA.startDistance,
  };
}

/** Posición de la cámara para un estado y un objetivo (puro, coordenadas Three). */
export function orbitPosition(state: OrbitState, target: Vec3): Vec3 {
  const az = (state.azimuth * Math.PI) / 180;
  const pol = (state.polar * Math.PI) / 180;
  const horizontal = Math.cos(pol) * state.distance;
  return {
    x: target.x + horizontal * Math.sin(az),
    y: target.y + Math.sin(pol) * state.distance,
    z: target.z + horizontal * Math.cos(az),
  };
}

/** Aplica un arrastre de (dx, dy) píxeles, respetando los límites. */
export function rotateOrbit(state: OrbitState, dxPx: number, dyPx: number): OrbitState {
  return {
    ...state,
    azimuth: normalizeDeg(state.azimuth - dxPx * CAMERA.rotateSpeedDegPerPx),
    polar: clamp(
      state.polar + dyPx * CAMERA.rotateSpeedDegPerPx,
      CAMERA.minPolarDeg,
      CAMERA.maxPolarDeg,
    ),
  };
}

/** `steps` > 0 aleja, < 0 acerca (una muesca de rueda = 1). */
export function zoomOrbit(state: OrbitState, steps: number): OrbitState {
  return {
    ...state,
    distance: clamp(
      state.distance + steps * CAMERA.zoomStep,
      CAMERA.minDistance,
      CAMERA.maxDistance,
    ),
  };
}

/** Dirección de avance en el plano lógico para WASD, según el azimut de la cámara. */
export function cameraForward(azimuthDeg: number): { x: number; y: number } {
  const az = (azimuthDeg * Math.PI) / 180;
  // La cámara mira del lado `(sin az, cos az)` hacia el objetivo; en el plano lógico Z = y.
  return { x: -Math.sin(az), y: -Math.cos(az) };
}

/** Derecha de la pantalla en el plano lógico para una dirección de avance. */
export function cameraRight(forward: { x: number; y: number }): { x: number; y: number } {
  return { x: -forward.y, y: forward.x };
}

/**
 * Cámara en órbita aplicada a una `THREE.PerspectiveCamera`: seguimiento
 * suavizado del objetivo y acortamiento por colisión contra la malla de la sala.
 */
export class OrbitRig {
  state: OrbitState = initialOrbit();
  private readonly target = new THREE.Vector3();
  private snapped = false;
  private readonly raycaster = new THREE.Raycaster();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Coloca la cámara detrás de un avatar que mira hacia `yawDeg`, sin suavizado. */
  reset(yawDeg: number): void {
    this.state = initialOrbit(yawDeg);
    this.snapped = false;
  }

  rotate(dxPx: number, dyPx: number): void {
    this.state = rotateOrbit(this.state, dxPx, dyPx);
  }

  zoom(steps: number): void {
    this.state = zoomOrbit(this.state, steps);
  }

  get azimuth(): number {
    return this.state.azimuth;
  }

  /** `anchor`: posición visual del avatar en coordenadas Three (se le suma `CAMERA_TARGET_HEIGHT`). */
  update(dt: number, anchor: Vec3, collision: THREE.Object3D | undefined): void {
    const desired = new THREE.Vector3(anchor.x, anchor.y + CAMERA_TARGET_HEIGHT, anchor.z);
    if (!this.snapped) {
      this.target.copy(desired);
      this.snapped = true;
    } else {
      this.target.lerp(desired, 1 - Math.exp(-dt / CAMERA_FOLLOW_TAU));
    }

    const wanted = orbitPosition(this.state, this.target);
    let distance = this.state.distance;
    if (collision) {
      const dir = new THREE.Vector3(wanted.x, wanted.y, wanted.z).sub(this.target).normalize();
      this.raycaster.set(this.target, dir);
      this.raycaster.far = this.state.distance;
      const hit = this.raycaster.intersectObject(collision, false)[0];
      if (hit) {
        distance = Math.max(CAMERA_MIN_EFFECTIVE, hit.distance - CAMERA.collisionMargin);
      }
    }
    const at = orbitPosition({ ...this.state, distance }, this.target);
    this.camera.position.set(at.x, at.y, at.z);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
