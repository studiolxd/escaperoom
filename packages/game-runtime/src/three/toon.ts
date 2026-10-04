import * as THREE from "three";

let gradient: THREE.DataTexture | undefined;

/** Degradado de 3 bandas (criterio de `tools/assets-generator/visor/main.js`). */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const cache = new WeakMap<THREE.Material, THREE.MeshToonMaterial>();

type Maybe = {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveMap?: THREE.Texture | null;
};

/** `MeshToonMaterial` equivalente a `material` (conserva mapa, color y emisivo). Con caché. */
export function toToon(material: THREE.Material): THREE.MeshToonMaterial {
  const cached = cache.get(material);
  if (cached) return cached;
  const src = material as THREE.Material & Maybe;
  const toon = new THREE.MeshToonMaterial({
    map: src.map ?? null,
    color: src.color ?? new THREE.Color(0xffffff),
    emissive: src.emissive ?? new THREE.Color(0x000000),
    emissiveMap: src.emissiveMap ?? null,
    gradientMap: toonGradient(),
  });
  cache.set(material, toon);
  return toon;
}

/** Aplica `toToon` a todas las mallas de una escena clonada. */
export function applyToon(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => toToon(m))
      : toToon(mesh.material);
  });
}
