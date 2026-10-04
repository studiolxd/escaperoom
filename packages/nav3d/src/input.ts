import type {
  Collider3D,
  Model3DSize,
  Piece3D,
  RoomPackage,
  Transform3D,
  World3D,
} from "@escaperoom/shared/schemas";
import { resolveModel3D, type Models3DCatalog } from "@escaperoom/shared/packs";

export interface NavInput {
  positions: Float32Array;
  indices: Uint32Array;
}

type Vec = readonly [number, number, number];

/** Sólido convexo a partir de sus vértices y caras (cuádrulos o triángulos). */
function solid(vertices: Vec[], faces: number[][]): { positions: number[]; indices: number[] } {
  // Une vértices coincidentes (la cuña con h0 = 0 cierra el frente en una arista).
  const unique: Vec[] = [];
  const remap = vertices.map((v) => {
    const found = unique.findIndex((u) => u[0] === v[0] && u[1] === v[1] && u[2] === v[2]);
    if (found >= 0) return found;
    unique.push(v);
    return unique.length - 1;
  });
  const center = [0, 1, 2].map((k) => unique.reduce((s, v) => s + v[k]!, 0) / unique.length) as [
    number,
    number,
    number,
  ];

  const indices: number[] = [];
  for (const face of faces) {
    const ring = face.map((i) => remap[i]!);
    for (let k = 1; k < ring.length - 1; k++) {
      const [a, b, c] = [ring[0]!, ring[k]!, ring[k + 1]!];
      if (a === b || b === c || a === c) continue;
      const va = unique[a]!;
      const vb = unique[b]!;
      const vc = unique[c]!;
      const u = [vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]];
      const w = [vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]];
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const outward = [0, 1, 2].map(
        (k2) => (va[k2]! + vb[k2]! + vc[k2]!) / 3 - center[k2]!,
      );
      const facing = n[0]! * outward[0]! + n[1]! * outward[1]! + n[2]! * outward[2]!;
      if (facing === 0) continue; // triángulo degenerado (área nula)
      // Caras hacia fuera, sentido antihorario (recast descarta las que miran hacia abajo).
      indices.push(a, facing > 0 ? b : c, facing > 0 ? c : b);
    }
  }
  return { positions: unique.flatMap((v) => [...v]), indices };
}

/** Triángulos de un colisionador en coordenadas del modelo (Three: X = x, Y = h, Z = y). */
export function colliderTriangles(collider: Collider3D): { positions: number[]; indices: number[] } {
  if (collider.type === "box") {
    const x0 = collider.cx - collider.sx / 2;
    const x1 = collider.cx + collider.sx / 2;
    const y0 = collider.ch - collider.sh / 2;
    const y1 = collider.ch + collider.sh / 2;
    const z0 = collider.cy - collider.sy / 2;
    const z1 = collider.cy + collider.sy / 2;
    const v: Vec[] = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    return solid(v, [
      [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
    ]);
  }
  // Cuña: base plana en h = 0; la cara superior sube de h0 a h1 avanzando en `dir`.
  const x0 = collider.cx - collider.sx / 2;
  const x1 = collider.cx + collider.sx / 2;
  const z0 = collider.cy - collider.sy / 2;
  const z1 = collider.cy + collider.sy / 2;
  const topHeight = (x: number, z: number): number => {
    switch (collider.dir) {
      case "x+": return x === x1 ? collider.h1 : collider.h0;
      case "x-": return x === x0 ? collider.h1 : collider.h0;
      case "y+": return z === z1 ? collider.h1 : collider.h0;
      case "y-": return z === z0 ? collider.h1 : collider.h0;
    }
  };
  const corners: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const v: Vec[] = [
    ...corners.map(([x, z]): Vec => [x, 0, z]),
    ...corners.map(([x, z]): Vec => [x, topHeight(x, z), z]),
  ];
  return solid(v, [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ]);
}

interface Placement {
  x: number;
  y: number;
  h: number;
  yaw: number;
  scale?: number | undefined;
}

/** Escala uniforme, giro `yaw` sobre el eje vertical y traslación `(x, h, y)`. */
function place(
  model: ReturnType<typeof resolveModel3D>,
  at: Placement,
  out: { positions: number[]; indices: number[] },
): void {
  if (!model) return;
  const s = at.scale ?? 1;
  const rad = (at.yaw * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const collider of model.colliders) {
    const tri = colliderTriangles(collider);
    const base = out.positions.length / 3;
    for (let i = 0; i < tri.positions.length; i += 3) {
      const px = tri.positions[i]! * s;
      const py = tri.positions[i + 1]! * s;
      const pz = tri.positions[i + 2]! * s;
      // Three: rotation.y = yaw · π / 180.
      out.positions.push(px * cos + pz * sin + at.x, py + at.h, -px * sin + pz * cos + at.y);
    }
    for (const index of tri.indices) out.indices.push(base + index);
  }
}

type CustomModels = World3D["models"] | Record<string, { size: Model3DSize; colliders: Collider3D[] }>;

/**
 * Geometría de una habitación a partir de sus partes sueltas, sin necesitar un
 * `RoomPackage` completo (la usa el runtime, que solo tiene el `RuntimeModel`).
 * `objects` son ya los que bloquean (specs/27 §5.1), con el modelo del estado inicial.
 */
export function buildNavInputFromParts(parts: {
  pieces: readonly Piece3D[];
  objects: readonly { modelId: string; transform: Transform3D }[];
  catalog: Models3DCatalog | undefined;
  customModels: CustomModels | undefined;
}): NavInput {
  const out = { positions: [] as number[], indices: [] as number[] };
  const custom = parts.customModels as World3D["models"] | undefined;
  for (const piece of parts.pieces) {
    place(resolveModel3D(piece.model, parts.catalog, custom), piece, out);
  }
  for (const object of parts.objects) {
    place(resolveModel3D(object.modelId, parts.catalog, custom), object.transform, out);
  }
  return { positions: Float32Array.from(out.positions), indices: Uint32Array.from(out.indices) };
}

/** Geometría de toda una habitación (specs/27 §5.1). */
export function buildNavInput(
  pkg: RoomPackage,
  roomId: string,
  catalog: Models3DCatalog | undefined,
): NavInput {
  const plateIds = new Set(
    pkg.puzzles.flatMap((p) => (p.type === "simultaneous_plates" ? p.plates.map((pl) => pl.objectId) : [])),
  );
  const objects: { modelId: string; transform: Transform3D }[] = [];
  for (const object of pkg.objects) {
    if (object.roomId !== roomId || !object.transform) continue;
    if (object.type === "puerta" || object.leadsTo !== undefined || plateIds.has(object.id)) continue;
    const state = object.states[object.initialState];
    const modelId = (typeof state === "object" ? state.sprite : undefined) ?? object.sprite;
    objects.push({ modelId, transform: object.transform });
  }
  return buildNavInputFromParts({
    pieces: pkg.world3d?.rooms[roomId]?.pieces ?? [],
    objects,
    catalog,
    customModels: pkg.world3d?.models,
  });
}
