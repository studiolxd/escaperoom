import { describe, expect, it } from "vitest";
import { inspectGlb, MODEL3D_LIMITS, readImageSize } from "../src/models3d";
import type { GlbIssueCode } from "../src/models3d";
import { buildGlb, cube } from "./fixtures/glb";

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w, false);
  dv.setUint32(20, h, false);
  return b;
};
const jpeg = (w: number, h: number) => {
  // SOI, APP0 (longitud 4), DHT falso, SOF0.
  const b = new Uint8Array(2 + 4 + 2 + 4 + 2 + 2 + 7);
  let p = 0;
  b.set([0xff, 0xd8], p);
  p += 2;
  b.set([0xff, 0xe0, 0x00, 0x04, 0, 0], p);
  p += 6;
  b.set([0xff, 0xc4, 0x00, 0x02], p);
  p += 4;
  b.set([0xff, 0xc0, 0x00, 0x0b, 8], p);
  p += 5;
  const dv = new DataView(b.buffer);
  dv.setUint16(p, h, false);
  dv.setUint16(p + 2, w, false);
  return b;
};
const webp = (kind: "VP8 " | "VP8L" | "VP8X", w: number, h: number) => {
  const b = new Uint8Array(40);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  ascii(8, "WEBP");
  ascii(12, kind);
  const dv = new DataView(b.buffer);
  if (kind === "VP8 ") {
    b.set([0x9d, 0x01, 0x2a], 23);
    dv.setUint16(26, w, true);
    dv.setUint16(28, h, true);
  } else if (kind === "VP8L") {
    b[20] = 0x2f;
    dv.setUint32(21, (w - 1) | ((h - 1) << 14), true);
  } else {
    const wm = w - 1;
    const hm = h - 1;
    b.set([wm & 255, (wm >> 8) & 255, (wm >> 16) & 255, hm & 255, (hm >> 8) & 255, (hm >> 16) & 255], 24);
  }
  return b;
};
const ktx2 = (w: number, h: number) => {
  const b = new Uint8Array(32);
  b.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(b.buffer);
  dv.setUint32(20, w, true);
  dv.setUint32(24, h, true);
  return b;
};

/** Un GLB con una imagen incrustada en el trozo BIN. */
const withImage = (img: Uint8Array) =>
  buildGlb(
    cube({
      buffers: [{ byteLength: img.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: img.length }],
      images: [{ bufferView: 0 }],
    }),
    img,
  );

const failure = (bytes: Uint8Array, limits?: Parameters<typeof inspectGlb>[1]) => {
  const r = inspectGlb(bytes, limits);
  if (r.ok) throw new Error("se esperaba un fallo");
  return r;
};

describe("inspectGlb: errores", () => {
  const cases: [GlbIssueCode, () => Uint8Array, Parameters<typeof inspectGlb>[1]?][] = [
    ["too_large", () => buildGlb(cube()), { maxBytes: 100 }],
    ["not_glb", () => new TextEncoder().encode("hola mundo, esto no es un glb")],
    [
      "bad_version",
      () => {
        const b = buildGlb(cube());
        new DataView(b.buffer).setUint32(4, 1, true);
        return b;
      },
    ],
    ["truncated", () => buildGlb(cube()).slice(0, 40)],
    [
      "bad_json",
      () => {
        const b = buildGlb({});
        b.set(new TextEncoder().encode("{{"), 20);
        return b;
      },
    ],
    ["too_many_triangles", () => buildGlb(cube()), { maxTriangles: 5 }],
    ["texture_too_large", () => withImage(png(4096, 16))],
    ["texture_unreadable", () => withImage(new Uint8Array(40).fill(7))],
    ["extension_not_allowed", () => buildGlb(cube({ extensionsUsed: ["KHR_materials_clearcoat"] }))],
    ["external_uri", () => buildGlb(cube({ buffers: [{ byteLength: 4, uri: "model.bin" }] }))],
    ["has_cameras", () => buildGlb(cube({ cameras: [{ type: "perspective" }] }))],
    ["has_lights", () => buildGlb(cube({ extensionsUsed: ["KHR_lights_punctual"] }))],
    ["no_mesh", () => buildGlb({ asset: { version: "2.0" }, nodes: [{}] })],
  ];
  for (const [code, build, limits] of cases) {
    it(code, () => {
      const r = failure(build(), limits);
      expect(r.code).toBe(code);
      expect(r.message.length).toBeGreaterThan(5);
    });
  }

  it("el mensaje de extensión dice cuál es", () => {
    const r = failure(buildGlb(cube({ extensionsRequired: ["KHR_materials_clearcoat"] })));
    expect(r.message).toContain("KHR_materials_clearcoat");
  });

  it("luces declaradas solo en un nodo", () => {
    const r = failure(
      buildGlb(cube({}, { extensions: { KHR_lights_punctual: { light: 0 } } })),
    );
    expect(r.code).toBe("has_lights");
  });

  it("POSITION sin min/max → bad_json", () => {
    const g = cube();
    delete (g.accessors[0] as Record<string, unknown>).min;
    expect(failure(buildGlb(g)).code).toBe("bad_json");
  });

  it("el mensaje de triángulos es accionable", () => {
    const r = failure(buildGlb(cube()), { maxTriangles: 5 });
    expect(r.message).toMatch(/12 triángulos/);
  });

  it("los modos distintos de 4 no suman triángulos", () => {
    const g = cube();
    (g.meshes[0]!.primitives[0] as Record<string, unknown>).mode = 1;
    const r = inspectGlb(buildGlb(g), { maxTriangles: 0 });
    expect(r.ok).toBe(true);
  });
});

describe("inspectGlb: modelo válido", () => {
  it("cubo: triángulos, envolvente y colisionador (Y del glTF → h)", () => {
    const r = inspectGlb(buildGlb(cube()));
    expect(r).toMatchObject({
      ok: true,
      triangles: 12,
      textures: [],
      clips: [],
      bounds: { min: { x: -1, y: -2, h: 0 }, max: { x: 1, y: 2, h: 3 } },
      size: { w: 2, d: 4, hgt: 3 },
      collider: { type: "box", cx: 0, cy: 0, ch: 1.5, sx: 2, sy: 4, sh: 3 },
    });
  });

  it("sin índices cuenta los vértices de POSITION", () => {
    const g = cube();
    delete (g.meshes[0]!.primitives[0] as Record<string, unknown>).indices;
    const r = inspectGlb(buildGlb(g));
    expect(r.ok && r.triangles).toBe(2);
  });

  it("scale y translation del nodo se reflejan en la envolvente", () => {
    const r = inspectGlb(buildGlb(cube({}, { scale: [2, 1, 0.5], translation: [10, 5, -3] })));
    expect(r).toMatchObject({
      ok: true,
      bounds: { min: { x: 8, y: -4, h: 5 }, max: { x: 12, y: -2, h: 8 } },
      size: { w: 4, d: 2, hgt: 3 },
    });
  });

  it("nodos anidados acumulan la matriz del padre", () => {
    const g = cube({
      scenes: [{ nodes: [1] }],
      nodes: [{ mesh: 0 }, { translation: [0, 10, 0], children: [0] }],
    });
    const r = inspectGlb(buildGlb(g));
    expect(r).toMatchObject({ ok: true, bounds: { min: { h: 10 }, max: { h: 13 } } });
  });

  it("una rotación de 90° sobre Y intercambia x e y lógicos", () => {
    const s = Math.SQRT1_2;
    const r = inspectGlb(buildGlb(cube({}, { rotation: [0, s, 0, s] })));
    expect(r.ok && r.size.w).toBeCloseTo(4);
    expect(r.ok && r.size.d).toBeCloseTo(2);
  });

  it("lados mínimos de 0,01", () => {
    const g = cube();
    (g.accessors[0] as Record<string, unknown>).min = [0, 0, 0];
    (g.accessors[0] as Record<string, unknown>).max = [0, 0, 0];
    const r = inspectGlb(buildGlb(g));
    expect(r.ok && r.size).toEqual({ w: 0.01, d: 0.01, hgt: 0.01 });
  });

  it("animaciones con y sin nombre", () => {
    const r = inspectGlb(buildGlb(cube({ animations: [{ name: "abrir" }, {}] })));
    expect(r.ok && r.clips).toEqual(["abrir", "anim-1"]);
  });

  it("extensiones permitidas pasan", () => {
    const r = inspectGlb(
      buildGlb(cube({ extensionsUsed: ["KHR_mesh_quantization", "EXT_texture_webp"] })),
    );
    expect(r.ok).toBe(true);
  });

  it("imágenes PNG, JPEG, WebP y KTX2 incrustadas", () => {
    expect(inspectGlb(withImage(png(512, 256)))).toMatchObject({
      ok: true,
      textures: [{ width: 512, height: 256 }],
    });
    expect(inspectGlb(withImage(jpeg(640, 480)))).toMatchObject({
      ok: true,
      textures: [{ width: 640, height: 480 }],
    });
    for (const kind of ["VP8 ", "VP8L", "VP8X"] as const) {
      expect(inspectGlb(withImage(webp(kind, 300, 200)))).toMatchObject({
        ok: true,
        textures: [{ width: 300, height: 200 }],
      });
    }
    expect(inspectGlb(withImage(ktx2(1024, 1024)))).toMatchObject({
      ok: true,
      textures: [{ width: 1024, height: 1024 }],
    });
  });

  it("imagen con data: URI", () => {
    const uri = `data:image/png;base64,${Buffer.from(png(64, 64)).toString("base64")}`;
    const r = inspectGlb(buildGlb(cube({ images: [{ uri }] })));
    expect(r.ok && r.textures).toEqual([{ width: 64, height: 64 }]);
  });

  it("readImageSize rechaza formatos desconocidos", () => {
    expect(readImageSize(new Uint8Array(40))).toBeNull();
  });

  it("los límites por defecto son los del brief", () => {
    expect(MODEL3D_LIMITS).toEqual({
      maxBytes: 15 * 1024 * 1024,
      maxTriangles: 100_000,
      maxTextureSize: 2048,
    });
  });
});
