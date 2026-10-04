import type { Collider3D, Model3DSize } from "../schemas/world3d";

/**
 * Inspector de GLB (encargo 7.8a, specs/27 §9). Puro y sin dependencias: lee a
 * mano la cabecera y el JSON del contenedor glTF binario, comprueba los
 * límites de la plataforma y mide el modelo (envolvente, colisionador por
 * defecto, animaciones). El servidor lo ejecuta al completar la subida de un
 * modelo de creador; no convierte ni optimiza nada.
 */

export const MODEL3D_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  maxTriangles: 100_000,
  maxTextureSize: 2048,
} as const;

export const MODEL3D_ALLOWED_EXTENSIONS = [
  "KHR_materials_emissive_strength",
  "KHR_texture_transform",
  "KHR_mesh_quantization",
  "EXT_meshopt_compression",
  "KHR_draco_mesh_compression",
  "EXT_texture_webp",
  "KHR_texture_basisu",
] as const;

export type Model3DLimits = { -readonly [K in keyof typeof MODEL3D_LIMITS]: number };

export type GlbIssueCode =
  | "not_glb"
  | "bad_version"
  | "truncated"
  | "bad_json"
  | "too_large"
  | "too_many_triangles"
  | "texture_too_large"
  | "texture_unreadable"
  | "extension_not_allowed"
  | "external_uri"
  | "has_cameras"
  | "has_lights"
  | "no_mesh";

export type GlbInspection =
  | { ok: false; code: GlbIssueCode; message: string }
  | {
      ok: true;
      triangles: number;
      textures: { width: number; height: number }[];
      clips: string[];
      /** Caja envolvente en coordenadas lógicas del modelo (x = X, y = Z, h = Y del glTF). */
      bounds: {
        min: { x: number; y: number; h: number };
        max: { x: number; y: number; h: number };
      };
      /** w = Δx, d = Δy, hgt = Δh (mínimo 0,01 cada uno). */
      size: Model3DSize;
      /** Colisionador por defecto: una caja con la envolvente. */
      collider: Collider3D;
    };

const MAX_CLIPS = 32;
const MIN_SIDE = 0.01;
const MAX_NODE_DEPTH = 256;

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

type Json = Record<string, unknown>;

const fail = (code: GlbIssueCode, message: string): GlbInspection => ({ ok: false, code, message });

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function formatMb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function formatInt(n: number): string {
  return n.toLocaleString("es-ES");
}

function decodeDataUri(uri: string): Uint8Array | null {
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  try {
    if (/;base64$/i.test(meta)) {
      const bin = atob(payload);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return null;
  }
}

/** Ancho y alto de una imagen incrustada (PNG, JPEG, WebP o KTX2), o `null`. */
export function readImageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (at: number, s: string) => {
    if (at + s.length > b.length) return false;
    for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
    return true;
  };
  // PNG: firma de 8 bytes y IHDR (ancho y alto u32 BE en 16 y 20).
  if (
    b.length >= 24 &&
    b[0] === 0x89 &&
    ascii(1, "PNG") &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a &&
    ascii(12, "IHDR")
  ) {
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
  }
  // JPEG: primer marcador SOF0–SOF15 (salvo DHT 0xC4, JPG 0xC8 y DAC 0xCC).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xff) {
        p++;
        continue;
      }
      const marker = b[p + 1]!;
      if (marker === 0xff) {
        p++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2;
        continue;
      }
      const len = dv.getUint16(p + 2, false);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (p + 9 > b.length) return null;
        return { height: dv.getUint16(p + 5, false), width: dv.getUint16(p + 7, false) };
      }
      if (len < 2) return null;
      p += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP y un primer trozo VP8 / VP8L / VP8X.
  if (b.length >= 30 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    if (ascii(12, "VP8 ")) {
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return {
        width: dv.getUint16(26, true) & 0x3fff,
        height: dv.getUint16(28, true) & 0x3fff,
      };
    }
    if (ascii(12, "VP8L")) {
      if (b[20] !== 0x2f) return null;
      const bits = dv.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (ascii(12, "VP8X")) {
      const w = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1;
      const h = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
      return { width: w, height: h };
    }
    return null;
  }
  // KTX2: identificador «KTX 20» y pixelWidth/pixelHeight u32 LE en 20 y 24.
  if (
    b.length >= 28 &&
    b[0] === 0xab &&
    ascii(1, "KTX 20") &&
    b[7] === 0xbb &&
    b[8] === 0x0d &&
    b[9] === 0x0a &&
    b[10] === 0x1a &&
    b[11] === 0x0a
  ) {
    return { width: dv.getUint32(20, true), height: dv.getUint32(24, true) };
  }
  return null;
}

type Mat = number[]; // 4×4 en columnas (como glTF)

const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat, b: Mat): Mat {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function nodeMatrix(node: Json): Mat {
  const m = arr(node.matrix);
  if (m.length === 16 && m.every((v) => num(v) !== undefined)) return m as number[];
  const t = arr(node.translation).map((v) => num(v) ?? 0);
  const r = arr(node.rotation).map((v) => num(v) ?? 0);
  const s = arr(node.scale).map((v) => num(v) ?? 1);
  const [tx, ty, tz] = [t[0] ?? 0, t[1] ?? 0, t[2] ?? 0];
  let [qx, qy, qz, qw] = [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r.length === 4 ? r[3]! : 1];
  const ql = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= ql;
  qy /= ql;
  qz /= ql;
  qw /= ql;
  const [sx, sy, sz] = [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx,
    2 * (qx * qy + qz * qw) * sx,
    2 * (qx * qz - qy * qw) * sx,
    0,
    2 * (qx * qy - qz * qw) * sy,
    (1 - 2 * (qx * qx + qz * qz)) * sy,
    2 * (qy * qz + qx * qw) * sy,
    0,
    2 * (qx * qz + qy * qw) * sz,
    2 * (qy * qz - qx * qw) * sz,
    (1 - 2 * (qx * qx + qy * qy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function readVec3(v: unknown): [number, number, number] | null {
  const a = arr(v);
  if (a.length < 3) return null;
  const x = num(a[0]);
  const y = num(a[1]);
  const z = num(a[2]);
  return x === undefined || y === undefined || z === undefined ? null : [x, y, z];
}

export function inspectGlb(
  bytes: Uint8Array,
  limits: Partial<Model3DLimits> = {},
): GlbInspection {
  const lim = { ...MODEL3D_LIMITS, ...limits };

  // 1. Tamaño.
  if (bytes.byteLength > lim.maxBytes) {
    return fail(
      "too_large",
      `El modelo ocupa ${formatMb(bytes.byteLength)}; el máximo es ${formatMb(lim.maxBytes)}`,
    );
  }

  // 2. Contenedor.
  if (bytes.byteLength < 4) return fail("not_glb", "El fichero no es un GLB (glTF binario)");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) {
    return fail("not_glb", "El fichero no es un GLB (glTF binario): falta la cabecera «glTF»");
  }
  if (bytes.byteLength < 12) return fail("truncated", "El GLB está cortado: cabecera incompleta");
  const version = dv.getUint32(4, true);
  if (version !== 2) {
    return fail("bad_version", `El GLB es de la versión ${version}; solo se admite la 2`);
  }
  if (dv.getUint32(8, true) !== bytes.byteLength) {
    return fail("truncated", "El GLB está cortado o dañado: su longitud no coincide con la cabecera");
  }
  let offset = 12;
  let jsonBytes: Uint8Array | null = null;
  let bin: Uint8Array | null = null;
  let first = true;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      return fail("truncated", "El GLB está cortado: trozo con cabecera incompleta");
    }
    const len = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + len > bytes.byteLength) {
      return fail("truncated", "El GLB está cortado: un trozo no cabe en el fichero");
    }
    if (first) {
      if (type !== CHUNK_JSON) {
        return fail("bad_json", "El primer trozo del GLB debe ser el JSON de glTF");
      }
      jsonBytes = bytes.subarray(start, start + len);
      first = false;
    } else if (type === CHUNK_BIN && bin === null) {
      bin = bytes.subarray(start, start + len);
    }
    offset = start + len + ((4 - (len % 4)) % 4);
  }
  if (jsonBytes === null) return fail("bad_json", "El GLB no contiene el trozo JSON de glTF");
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes));
  } catch {
    return fail("bad_json", "El JSON de glTF del modelo no se puede leer");
  }
  if (!isObj(parsed)) return fail("bad_json", "El JSON de glTF del modelo no es un objeto");
  const gltf = parsed;

  // 3. Extensiones.
  const allowed = new Set<string>(MODEL3D_ALLOWED_EXTENSIONS);
  for (const key of ["extensionsUsed", "extensionsRequired"] as const) {
    for (const ext of arr(gltf[key])) {
      if (ext === "KHR_lights_punctual") {
        return fail("has_lights", "El modelo no puede incluir luces (KHR_lights_punctual)");
      }
      if (typeof ext !== "string" || !allowed.has(ext)) {
        return fail(
          "extension_not_allowed",
          `El modelo usa la extensión «${String(ext)}», que no está admitida`,
        );
      }
    }
  }

  // 4. Recursos externos.
  for (const key of ["buffers", "images"] as const) {
    for (const item of arr(gltf[key])) {
      const uri = isObj(item) ? item.uri : undefined;
      if (uri !== undefined && !(typeof uri === "string" && uri.startsWith("data:"))) {
        return fail(
          "external_uri",
          `El modelo referencia un fichero externo en «${key}»; exporta el GLB con todo incrustado`,
        );
      }
    }
  }

  // 5. Cámaras y luces.
  if (arr(gltf.cameras).length > 0) {
    return fail("has_cameras", "El modelo no puede incluir cámaras");
  }
  if (arr(gltf.nodes).some((n) => isObj(n) && isObj(n.extensions) && "KHR_lights_punctual" in n.extensions)) {
    return fail("has_lights", "El modelo no puede incluir luces (KHR_lights_punctual)");
  }

  // 6. Mallas.
  const meshes = arr(gltf.meshes);
  const hasPrimitive = meshes.some((m) => isObj(m) && arr(m.primitives).some(isObj));
  if (!hasPrimitive) return fail("no_mesh", "El modelo no contiene ninguna malla");

  const accessors = arr(gltf.accessors);
  const accessorAt = (i: unknown): Json | null => {
    const a = typeof i === "number" ? accessors[i] : undefined;
    return isObj(a) ? a : null;
  };

  // 7. Triángulos.
  let triangles = 0;
  for (const mesh of meshes) {
    if (!isObj(mesh)) continue;
    for (const prim of arr(mesh.primitives)) {
      if (!isObj(prim)) continue;
      const mode = prim.mode === undefined ? 4 : prim.mode;
      if (mode !== 4) continue;
      const source =
        prim.indices !== undefined
          ? accessorAt(prim.indices)
          : accessorAt(isObj(prim.attributes) ? prim.attributes.POSITION : undefined);
      const count = source ? num(source.count) : undefined;
      if (count === undefined) {
        return fail("bad_json", "Una primitiva del modelo apunta a un accessor que no existe");
      }
      triangles += Math.floor(count / 3);
    }
  }
  if (triangles > lim.maxTriangles) {
    return fail(
      "too_many_triangles",
      `El modelo tiene ${formatInt(triangles)} triángulos; el máximo es ${formatInt(lim.maxTriangles)}`,
    );
  }

  // 8. Texturas.
  const textures: { width: number; height: number }[] = [];
  const buffers = arr(gltf.buffers);
  const bufferViews = arr(gltf.bufferViews);
  const images = arr(gltf.images);
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    if (!isObj(image)) continue;
    let data: Uint8Array | null = null;
    if (typeof image.uri === "string") {
      data = decodeDataUri(image.uri);
    } else if (typeof image.bufferView === "number") {
      const view = bufferViews[image.bufferView];
      if (isObj(view)) {
        const bufIndex = num(view.buffer);
        const buf = bufIndex === undefined ? undefined : buffers[bufIndex];
        let source: Uint8Array | null = null;
        if (isObj(buf)) {
          source = typeof buf.uri === "string" ? decodeDataUri(buf.uri) : bufIndex === 0 ? bin : null;
        }
        const from = num(view.byteOffset) ?? 0;
        const length = num(view.byteLength);
        if (source && length !== undefined && from >= 0 && from + length <= source.byteLength) {
          data = source.subarray(from, from + length);
        }
      }
    } else {
      continue; // sin datos que medir
    }
    const size = data ? readImageSize(data) : null;
    if (!size) {
      return fail(
        "texture_unreadable",
        `No se puede leer la textura ${i + 1} del modelo; usa PNG, JPEG, WebP o KTX2`,
      );
    }
    if (size.width > lim.maxTextureSize || size.height > lim.maxTextureSize) {
      return fail(
        "texture_too_large",
        `La textura ${i + 1} mide ${size.width}×${size.height} px; el máximo es ${lim.maxTextureSize}×${lim.maxTextureSize}`,
      );
    }
    textures.push(size);
  }

  // 9. Envolvente.
  const nodes = arr(gltf.nodes);
  const scenes = arr(gltf.scenes);
  let rootIndices: number[];
  const sceneIndex = num(gltf.scene) ?? 0;
  const scene = scenes[sceneIndex];
  if (isObj(scene)) {
    rootIndices = arr(scene.nodes).filter((n): n is number => typeof n === "number");
  } else {
    const children = new Set<number>();
    for (const n of nodes) {
      if (isObj(n)) for (const c of arr(n.children)) if (typeof c === "number") children.add(c);
    }
    rootIndices = nodes.map((_, i) => i).filter((i) => !children.has(i));
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let badBounds = false;
  const visit = (index: number, parent: Mat, depth: number): void => {
    if (depth > MAX_NODE_DEPTH) return;
    const node = nodes[index];
    if (!isObj(node)) return;
    const world = mul(parent, nodeMatrix(node));
    if (typeof node.mesh === "number") {
      const mesh = meshes[node.mesh];
      for (const prim of isObj(mesh) ? arr(mesh.primitives) : []) {
        if (!isObj(prim)) continue;
        const acc = accessorAt(isObj(prim.attributes) ? prim.attributes.POSITION : undefined);
        const lo = acc ? readVec3(acc.min) : null;
        const hi = acc ? readVec3(acc.max) : null;
        if (!lo || !hi) {
          badBounds = true;
          return;
        }
        for (let corner = 0; corner < 8; corner++) {
          const px = corner & 1 ? hi[0] : lo[0];
          const py = corner & 2 ? hi[1] : lo[1];
          const pz = corner & 4 ? hi[2] : lo[2];
          for (let axis = 0; axis < 3; axis++) {
            const v = world[axis]! * px + world[4 + axis]! * py + world[8 + axis]! * pz + world[12 + axis]!;
            if (v < min[axis]!) min[axis] = v;
            if (v > max[axis]!) max[axis] = v;
          }
        }
      }
    }
    for (const child of arr(node.children)) {
      if (typeof child === "number") visit(child, world, depth + 1);
    }
  };
  for (const root of rootIndices) visit(root, IDENTITY, 0);
  if (badBounds) {
    return fail("bad_json", "Una malla del modelo no declara los límites (min/max) de su POSITION");
  }
  if (!Number.isFinite(min[0]!)) {
    return fail("no_mesh", "La escena del modelo no contiene ninguna malla");
  }

  // 10. Animaciones.
  const clips: string[] = [];
  arr(gltf.animations).forEach((a, i) => {
    if (clips.length >= MAX_CLIPS) return;
    const name = isObj(a) && typeof a.name === "string" && a.name !== "" ? a.name : `anim-${i}`;
    clips.push(name);
  });

  // 11. Tamaño y colisionador. Ejes lógicos: x = X, y = Z, h = Y.
  const lo = { x: min[0]!, y: min[2]!, h: min[1]! };
  const hi = { x: max[0]!, y: max[2]!, h: max[1]! };
  const side = (a: number, b: number) => Math.max(MIN_SIDE, b - a);
  const size: Model3DSize = { w: side(lo.x, hi.x), d: side(lo.y, hi.y), hgt: side(lo.h, hi.h) };
  const collider: Collider3D = {
    type: "box",
    cx: (lo.x + hi.x) / 2,
    cy: (lo.y + hi.y) / 2,
    ch: (lo.h + hi.h) / 2,
    sx: size.w,
    sy: size.d,
    sh: size.hgt,
  };
  return { ok: true, triangles, textures, clips, bounds: { min: lo, max: hi }, size, collider };
}
