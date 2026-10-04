// Ayudas de test: GLB mínimo en memoria (encargo 7.8a).

/** Monta un GLB mínimo en memoria. */
export function buildGlb(json: unknown, bin?: Uint8Array): Uint8Array {
  const pad = (b: Uint8Array, fill: number) => {
    const n = (4 - (b.length % 4)) % 4;
    const out = new Uint8Array(b.length + n).fill(fill);
    out.set(b);
    return out;
  };
  const j = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const bn = bin ? pad(bin, 0) : null;
  const total = 12 + 8 + j.length + (bn ? 8 + bn.length : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, j.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  if (bn) {
    const at = 20 + j.length;
    dv.setUint32(at, bn.length, true);
    dv.setUint32(at + 4, 0x004e4942, true);
    out.set(bn, at + 8);
  }
  return out;
}

export const cube = (extra: Record<string, unknown> = {}, node: Record<string, unknown> = {}) => ({
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, ...node }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [
    { count: 8, componentType: 5126, type: "VEC3", min: [-1, 0, -2], max: [1, 3, 2] },
    { count: 36, componentType: 5123, type: "SCALAR" },
  ],
  ...extra,
});
