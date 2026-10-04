import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toToon } from "./toon";

export interface ModelViewerOptions {
  /** Color de fondo; por defecto `#0b1120`. */
  backgroundColor?: string;
}

export type ModelViewerMaterial = "toon" | "original";

const DEFAULT_BACKGROUND = "#0b1120";

/**
 * Visor imperativo de un GLB suelto (subida de modelos y moderación, specs/27 §9): escena
 * mínima con órbita, rejilla de 1 m y las luces del runtime. No usa `RoomRuntime3D`.
 */
export class ModelViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly grid = new THREE.GridHelper(20, 20, 0x475569, 0x1e293b);
  private model: THREE.Object3D | undefined;
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private animations: THREE.AnimationClip[] = [];
  private mixer: THREE.AnimationMixer | undefined;
  private material: ModelViewerMaterial = "toon";
  private loadToken = 0;
  private destroyed = false;

  constructor(
    private readonly parent: HTMLElement,
    options: ModelViewerOptions = {},
  ) {
    this.scene.background = new THREE.Color(options.backgroundColor ?? DEFAULT_BACKGROUND);
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(-0.7, 0.9, 0.5).multiplyScalar(10);
    this.scene.add(sun, new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 0.6), this.grid);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    parent.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.camera.position.set(2, 1.5, 2);
    this.resize();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(parent);
    }
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Carga el GLB, lo encuadra y devuelve los nombres de sus animaciones. Rechaza si falla. */
  async load(url: string): Promise<{ clips: string[] }> {
    const token = ++this.loadToken;
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    if (this.destroyed || token !== this.loadToken) {
      disposeObject(gltf.scene);
      return { clips: [] };
    }
    this.unloadModel();
    this.model = gltf.scene;
    this.animations = gltf.animations;
    this.originals.clear();
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) this.originals.set(mesh, mesh.material);
    });
    this.scene.add(gltf.scene);
    this.applyMaterial();
    this.frameModel();
    return { clips: gltf.animations.map((a, i) => a.name || `anim-${i}`) };
  }

  setMaterial(mode: ModelViewerMaterial): void {
    this.material = mode;
    this.applyMaterial();
  }

  /** Reproduce el clip en bucle; `null` lo detiene. */
  setClip(name: string | null): void {
    this.mixer?.stopAllAction();
    this.mixer = undefined;
    if (!this.model || name === null) return;
    const index = this.animations.findIndex((a, i) => (a.name || `anim-${i}`) === name);
    const clip = this.animations[index];
    if (!clip) return;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.mixer.clipAction(clip).play();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    this.unloadModel();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private applyMaterial(): void {
    for (const [mesh, original] of this.originals) {
      mesh.material =
        this.material === "original"
          ? original
          : Array.isArray(original)
            ? original.map((m) => toToon(m))
            : toToon(original);
    }
  }

  private unloadModel(): void {
    this.mixer?.stopAllAction();
    this.mixer = undefined;
    if (this.model) {
      this.scene.remove(this.model);
      // Los toon creados no cuelgan del GLB: se liberan aparte.
      for (const mesh of this.originals.keys()) {
        const current = mesh.material;
        for (const m of Array.isArray(current) ? current : [current]) {
          if ((m as THREE.MeshToonMaterial).isMeshToonMaterial) m.dispose();
        }
      }
      for (const [mesh, original] of this.originals) mesh.material = original;
      disposeObject(this.model);
    }
    this.model = undefined;
    this.originals.clear();
    this.animations = [];
  }

  /** Cámara a la distancia que deja ver la caja envolvente entera. */
  private frameModel(): void {
    if (!this.model) return;
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (radius / Math.sin(Math.min(fov / 2, (fov / 2) * Math.max(this.camera.aspect, 1)))) * 1.1;
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance));
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  private resize(): void {
    const width = Math.max(this.parent.clientWidth, 1);
    const height = Math.max(this.parent.clientHeight, 1);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    this.mixer?.update(this.clock.getDelta());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

/** Libera geometrías, materiales y texturas de un árbol cargado por `GLTFLoader`. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(m)) {
        if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
      }
      m.dispose();
    }
  });
}
