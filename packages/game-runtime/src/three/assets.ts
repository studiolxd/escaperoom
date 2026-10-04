import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Models3DCatalog } from "@escaperoom/shared/packs";
import { applyToon, toonGradient } from "./toon";

export type BoxKind =
  | "suelo"
  | "muro"
  | "estructura"
  | "mueble"
  | "pared"
  | "suelto"
  | "propio"
  | "desconocido";

export const BOX_COLORS: Record<BoxKind, string> = {
  suelo: "#57534e",
  muro: "#78716c",
  estructura: "#a8a29e",
  mueble: "#b45309",
  pared: "#7c3aed",
  suelto: "#0891b2",
  propio: "#be185d",
  desconocido: "#dc2626",
};

export interface AssetContext {
  catalog: Models3DCatalog | undefined;
  customModels: Record<string, { ref: string; size: { w: number; d: number; hgt: number } }>;
  packBaseUrl: string | undefined;
  resolveCustomModelUrl: ((ref: string) => string | undefined) | undefined;
}

export interface ModelVisual {
  kind: BoxKind;
  size: { w: number; d: number; hgt: number };
  /** `undefined` = solo caja de sustitución. */
  url: string | undefined;
}

/** Qué pintar para un id de modelo: tamaño, tipo de caja y URL del GLB (si la hay). */
export function resolveVisual(modelId: string, ctx: AssetContext): ModelVisual {
  if (Object.hasOwn(ctx.customModels, modelId)) {
    const own = ctx.customModels[modelId]!;
    return { kind: "propio", size: own.size, url: ctx.resolveCustomModelUrl?.(own.ref) };
  }
  if (ctx.catalog && Object.hasOwn(ctx.catalog.models, modelId)) {
    const entry = ctx.catalog.models[modelId]!;
    return {
      kind: entry.category,
      size: entry.size,
      url: ctx.packBaseUrl === undefined ? undefined : `${ctx.packBaseUrl}/${entry.file}`,
    };
  }
  return { kind: "desconocido", size: { w: 1, d: 1, hgt: 1 }, url: undefined };
}

/**
 * Fábrica de cajas de sustitución con la base en el origen (cara superior en el
 * origen en las piezas de suelo, como el modelo real, specs/27 §2). Comparte
 * geometría y material entre cajas iguales; quien la crea debe llamar a `dispose`.
 */
export class BoxFactory {
  private readonly cache = new Map<
    string,
    { geometry: THREE.BoxGeometry; material: THREE.MeshToonMaterial }
  >();

  create(visual: Pick<ModelVisual, "kind" | "size">): THREE.Mesh {
    const { w, d, hgt } = visual.size;
    const key = `${visual.kind}|${w}|${d}|${hgt}`;
    let shared = this.cache.get(key);
    if (!shared) {
      const geometry = new THREE.BoxGeometry(w, hgt, d);
      geometry.translate(0, visual.kind === "suelo" ? -hgt / 2 : hgt / 2, 0);
      const material = new THREE.MeshToonMaterial({
        color: BOX_COLORS[visual.kind],
        gradientMap: toonGradient(),
      });
      shared = { geometry, material };
      this.cache.set(key, shared);
    }
    return new THREE.Mesh(shared.geometry, shared.material);
  }

  dispose(): void {
    for (const { geometry, material } of this.cache.values()) {
      geometry.dispose();
      material.dispose();
    }
    this.cache.clear();
  }
}

let loader: GLTFLoader | undefined;
const cache = new Map<string, Promise<GLTF>>();

function gltfLoader(): GLTFLoader {
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/** GLB cacheado por URL (a nivel de módulo). Un fallo no se cachea. */
export function loadGltf(url: string): Promise<GLTF> {
  let pending = cache.get(url);
  if (!pending) {
    pending = gltfLoader().loadAsync(url);
    cache.set(url, pending);
    pending.catch(() => cache.delete(url));
  }
  return pending;
}

export interface LoadedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/** Clon con material toon de un GLB (con esqueleto si lo tiene). Comparte geometrías con la caché. */
export async function instantiateModel(url: string): Promise<LoadedModel> {
  const gltf = await loadGltf(url);
  let skinned = false;
  gltf.scene.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  const scene = skinned ? cloneSkinned(gltf.scene) : gltf.scene.clone(true);
  applyToon(scene);
  return { scene, animations: gltf.animations };
}
