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

/** Velocidad (m/s) de la cámara libre del observador. */
export const FREE_CAMERA_SPEED = 5;
/** Margen (m) de la cámara libre alrededor de la caja de la habitación. */
export const FREE_CAMERA_MARGIN = 5;
export const FREE_CAMERA_MIN_H = 0.5;
export const FREE_CAMERA_MAX_H = 15;
export const FREE_CAMERA_MAX_PITCH = 80;

/** Cámara libre: posición en el plano lógico (`x`, `y`) y altura `h`; ángulos en grados. */
export interface FreeCameraState {
  x: number;
  y: number;
  h: number;
  /** Mismo convenio que `OrbitState.azimuth`: avanza hacia `cameraForward(azimuth)`. */
  azimuth: number;
  /** Positivo = mira hacia abajo, [−80, 80]. */
  pitch: number;
}

/**
 * Mueve la cámara libre `dt` segundos. `forward`/`right` van en el plano respecto a hacia
 * donde mira (módulo ≤ 1, se recorta si lo supera); `up` sube (+) o baja (−) la cámara.
 * Queda dentro de la caja de la habitación ampliada `FREE_CAMERA_MARGIN` y de 0,5 a 15 m.
 */
export function moveFreeCamera(
  state: FreeCameraState,
  input: { forward: number; right: number; up: number },
  dt: number,
  bounds: { cols: number; rows: number },
): FreeCameraState {
  const fwd = cameraForward(state.azimuth);
  const right = cameraRight(fwd);
  let f = input.forward;
  let r = input.right;
  const len = Math.hypot(f, r);
  if (len > 1) {
    f /= len;
    r /= len;
  }
  const reach = FREE_CAMERA_SPEED * dt;
  return {
    ...state,
    x: clamp(state.x + (fwd.x * f + right.x * r) * reach, -FREE_CAMERA_MARGIN, bounds.cols + FREE_CAMERA_MARGIN),
    y: clamp(state.y + (fwd.y * f + right.y * r) * reach, -FREE_CAMERA_MARGIN, bounds.rows + FREE_CAMERA_MARGIN),
    h: clamp(state.h + input.up * reach, FREE_CAMERA_MIN_H, FREE_CAMERA_MAX_H),
  };
}

/** Aplica un arrastre de (dx, dy) píxeles a la cámara libre (mismo factor y sentido que la órbita). */
export function rotateFreeCamera(state: FreeCameraState, dxPx: number, dyPx: number): FreeCameraState {
  return {
    ...state,
    azimuth: normalizeDeg(state.azimuth - dxPx * CAMERA.rotateSpeedDegPerPx),
    pitch: clamp(
      state.pitch + dyPx * CAMERA.rotateSpeedDegPerPx,
      -FREE_CAMERA_MAX_PITCH,
      FREE_CAMERA_MAX_PITCH,
    ),
  };
}

/** Dirección de la mirada de la cámara libre (coordenadas Three, unitaria). */
export function freeCameraDirection(state: FreeCameraState): Vec3 {
  const fwd = cameraForward(state.azimuth);
  const pitch = (state.pitch * Math.PI) / 180;
  return { x: fwd.x * Math.cos(pitch), y: -Math.sin(pitch), z: fwd.y * Math.cos(pitch) };
}

/** Cámara libre que ve lo mismo que una cámara en `position` mirando hacia `direction` (coordenadas Three). */
export function freeCameraFromLook(position: Vec3, direction: Vec3): FreeCameraState {
  const horizontal = Math.hypot(direction.x, direction.z);
  return {
    x: position.x,
    y: position.z,
    h: position.y,
    azimuth: horizontal > 1e-9 ? normalizeDeg((Math.atan2(-direction.x, -direction.z) * 180) / Math.PI) : 0,
    pitch: clamp(
      (Math.atan2(-direction.y, horizontal) * 180) / Math.PI,
      -FREE_CAMERA_MAX_PITCH,
      FREE_CAMERA_MAX_PITCH,
    ),
  };
}

/** Cámara de editor (specs/27 §8): órbita alrededor de un pivote en el plano de trabajo. */
export const EDITOR_CAMERA = {
  minDistance: 2,
  maxDistance: 60,
  minElevationDeg: 5,
  maxElevationDeg: 89,
  startElevationDeg: 50,
  zoomOutFactor: 1.1,
  zoomInFactor: 0.9,
  startDistanceFactor: 1.2,
} as const;

export interface EditorCameraState {
  /** Mismo convenio que `OrbitState.azimuth`. */
  azimuth: number;
  /** Elevación en grados: 0 = horizontal, 90 = cenital. */
  elevation: number;
  distance: number;
  /** Punto al que mira la cámara (coordenadas Three). */
  pivot: Vec3;
}

/** Estado inicial: pivote en el centro de la habitación, a `workHeight`. */
export function initialEditorCamera(
  room: { cols: number; rows: number },
  workHeight = 0,
): EditorCameraState {
  return {
    azimuth: 0,
    elevation: EDITOR_CAMERA.startElevationDeg,
    distance: clamp(
      Math.max(room.cols, room.rows) * EDITOR_CAMERA.startDistanceFactor,
      EDITOR_CAMERA.minDistance,
      EDITOR_CAMERA.maxDistance,
    ),
    pivot: { x: room.cols / 2, y: workHeight, z: room.rows / 2 },
  };
}

/** Posición de la cámara de editor (puro, coordenadas Three). */
export function editorCameraPosition(state: EditorCameraState): Vec3 {
  return orbitPosition(
    { azimuth: state.azimuth, polar: state.elevation, distance: state.distance },
    state.pivot,
  );
}

/** Gira con un arrastre de (dx, dy) píxeles; elevación limitada a 5°–89°. */
export function rotateEditor(state: EditorCameraState, dxPx: number, dyPx: number): EditorCameraState {
  return {
    ...state,
    azimuth: normalizeDeg(state.azimuth - dxPx * CAMERA.rotateSpeedDegPerPx),
    elevation: clamp(
      state.elevation + dyPx * CAMERA.rotateSpeedDegPerPx,
      EDITOR_CAMERA.minElevationDeg,
      EDITOR_CAMERA.maxElevationDeg,
    ),
  };
}

/**
 * Desplaza el pivote por el plano de trabajo con un arrastre de (dx, dy) píxeles, de modo que el
 * suelo «sigue» al puntero. `viewportHeightPx` es el alto del lienzo (fija los metros por píxel).
 */
export function panPivot(
  state: EditorCameraState,
  dxPx: number,
  dyPx: number,
  viewportHeightPx: number,
): EditorCameraState {
  if (viewportHeightPx <= 0) return state;
  const metersPerPx = (2 * state.distance * Math.tan((CAMERA.fovDeg * Math.PI) / 360)) / viewportHeightPx;
  const forward = cameraForward(state.azimuth);
  const right = cameraRight(forward);
  // En el suelo, un píxel vertical abarca 1 / sin(elevación) píxeles de «profundidad».
  const depth = metersPerPx / Math.sin((state.elevation * Math.PI) / 180);
  const sideways = dxPx * metersPerPx;
  const ahead = dyPx * depth;
  return {
    ...state,
    pivot: {
      x: state.pivot.x - right.x * sideways + forward.x * ahead,
      y: state.pivot.y,
      z: state.pivot.z - right.y * sideways + forward.y * ahead,
    },
  };
}

/** `steps` > 0 aleja (×1,1 por paso), < 0 acerca (×0,9); distancia limitada a 2–60 m. */
export function zoomEditor(state: EditorCameraState, steps: number): EditorCameraState {
  const factor = steps >= 0 ? EDITOR_CAMERA.zoomOutFactor : EDITOR_CAMERA.zoomInFactor;
  return {
    ...state,
    distance: clamp(
      state.distance * factor ** Math.abs(steps),
      EDITOR_CAMERA.minDistance,
      EDITOR_CAMERA.maxDistance,
    ),
  };
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

  /** El objetivo salta al avatar en el próximo `update` en vez de suavizarse. */
  snap(): void {
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
