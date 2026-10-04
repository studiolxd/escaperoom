import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getModels3DCatalog, Models3DCatalogSchema, resolveModel3D } from "../src/packs";
import type { Models3DCatalog } from "../src/packs";
import { makeRoom3D } from "./fixtures/room-3d";

/** Catálogo de modelos del pack (encargo 7.1a, specs/27 §4; generado en el encargo 7.10a). */

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../tools/assets-generator/packs/medieval-v1/modelos3d.json", import.meta.url)), "utf8"),
) as { alias: Record<string, string> };

/** Kit de la spec §4.1 y su categoría. */
const KIT_CATEGORY: Record<string, string> = {
  "suelo-piedra-1": "suelo", "suelo-piedra-2": "suelo", "suelo-alfombra": "suelo", "suelo-madera": "suelo",
  muro: "muro", "muro-arco": "muro", "muro-ventana": "muro",
  columna: "estructura", escalon: "estructura", tarima: "estructura", rampa: "estructura", escalera: "estructura",
  umbral: "estructura", trampilla: "estructura",
};
const KIT_SPEC = Object.keys(KIT_CATEGORY);

const plantaCompleta = (h: number) => [{ type: "box", cx: 0, cy: 0, ch: h / 2, sx: 1, sy: 1, sh: h }];
const losa = [{ type: "box", cx: 0, cy: 0, ch: -0.05, sx: 1, sy: 1, sh: 0.1 }];

/** Colisionadores que tenía el catálogo escrito a mano antes del encargo 7.10a: el kit los conserva tal cual. */
const KIT_COLLIDERS: Record<string, unknown[]> = {
  "suelo-piedra-1": losa, "suelo-piedra-2": losa, "suelo-alfombra": losa, "suelo-madera": losa,
  muro: plantaCompleta(2.4),
  "muro-ventana": plantaCompleta(2.4),
  "muro-arco": [
    { type: "box", cx: -0.45, cy: 0, ch: 1.0, sx: 0.1, sy: 1, sh: 2.0 },
    { type: "box", cx: 0.45, cy: 0, ch: 1.0, sx: 0.1, sy: 1, sh: 2.0 },
    { type: "box", cx: 0, cy: 0, ch: 2.2, sx: 1, sy: 1, sh: 0.4 },
  ],
  columna: [{ type: "box", cx: 0, cy: 0, ch: 1.2, sx: 0.5, sy: 0.5, sh: 2.4 }],
  escalon: plantaCompleta(0.2),
  tarima: plantaCompleta(0.4),
  rampa: [{ type: "ramp", cx: 0, cy: 0, sx: 1, sy: 2, h0: 0, h1: 0.4, dir: "y-" }],
  escalera: [{ type: "ramp", cx: 0, cy: 0, sx: 1, sy: 2, h0: 0, h1: 1.0, dir: "y-" }],
  umbral: plantaCompleta(0.05),
  trampilla: plantaCompleta(0.05),
};

const catalog: Models3DCatalog = {
  packId: "medieval-v1",
  version: "0.0.1",
  models: {
    arca: {
      file: "models/arca.glb",
      category: "mueble",
      label: { es: { text: "Arca" } },
      size: { w: 1, d: 1, hgt: 1 },
      colliders: [],
      snap: false,
      clips: ["abrir"],
    },
  },
  avatars: {},
};

describe("catálogo de modelos 3D", () => {
  it("el JSON de medieval-v1 valida y es el que devuelve getModels3DCatalog", () => {
    const path = fileURLToPath(new URL("../src/packs/medieval-v1.models3d.json", import.meta.url));
    const json = JSON.parse(readFileSync(path, "utf8")) as unknown;
    expect(Models3DCatalogSchema.safeParse(json).success).toBe(true);
    expect(getModels3DCatalog("medieval-v1")).toEqual(json);
  });

  it("medieval-v1 trae el kit completo de la spec §4.1, los objetos del Rey Aldric y el avatar (encargo 7.10a)", () => {
    const real = getModels3DCatalog("medieval-v1")!;
    expect(real.version).toBe("1.0.0");
    for (const id of KIT_SPEC) {
      expect(real.models[id]?.snap, id).toBe(true);
      expect(real.models[id]?.category, id).toBe(KIT_CATEGORY[id]);
    }
    expect(Object.entries(real.models).filter(([, m]) => m.snap).map(([id]) => id).sort()).toEqual([...KIT_SPEC].sort());
    expect(Object.keys(real.avatars)).toEqual(["caballero-m"]);
    expect(real.avatars["caballero-m"]).toMatchObject({
      file: "avatars/caballero-m.glb",
      height: 1.75,
      clips: { idle: "idle", walk: "walk", interact: "interact" },
    });
    const alias = Object.keys(config.alias);
    for (const [id, model] of Object.entries(real.models)) {
      expect(model.file, id).toBe(`models/${alias.includes(id) ? config.alias[id] : id}.glb`);
      expect(Object.keys(model.label).sort(), id).toEqual(["en", "es"]);
      expect(model.size.w, `${id}.w`).toBeGreaterThan(0);
    }
  });

  it("los colisionadores del kit son los que ya tenía el catálogo", () => {
    const real = getModels3DCatalog("medieval-v1")!;
    for (const [id, colliders] of Object.entries(KIT_COLLIDERS)) {
      expect(real.models[id]?.colliders, id).toEqual(colliders);
    }
    expect(Object.keys(KIT_COLLIDERS).sort()).toEqual([...KIT_SPEC].sort());
  });

  it("toda pieza snap: true tiene medidas en planta enteras", () => {
    const real = getModels3DCatalog("medieval-v1")!;
    const snapped = Object.entries(real.models).filter(([, model]) => model.snap);
    expect(snapped).toHaveLength(14);
    for (const [id, model] of snapped) {
      expect(Number.isInteger(model.size.w), `${id}.w`).toBe(true);
      expect(Number.isInteger(model.size.d), `${id}.d`).toBe(true);
    }
  });

  it("los alias existen y comparten fichero y metadatos con su modelo", () => {
    const real = getModels3DCatalog("medieval-v1")!;
    expect(Object.keys(config.alias)).toEqual(expect.arrayContaining(["puerta-madera", "puerta-madera-abierta", "placa-piedra"]));
    for (const [alias, target] of Object.entries(config.alias)) {
      expect(real.models[target], target).toBeDefined();
      expect(real.models[alias], alias).toEqual(real.models[target]);
    }
  });

  it("las categorías siguen el reparto del brief: cada familia en la suya", () => {
    const real = getModels3DCatalog("medieval-v1")!;
    const cat = (id: string) => real.models[id]?.category;
    for (const id of ["llave-bronce-suelo", "yesquero-suelo", "antorcha-apagada-suelo", "placa-arriba", "vasijas-8"]) expect(cat(id), id).toBe("suelto");
    for (const id of ["puerta-cerrada", "reja-abierta", "compuerta-cerrada", "canal", "canal-tramo", "columna", "escalon", "umbral"]) expect(cat(id), id).toBe("estructura");
    for (const id of ["antorcha", "cuadro-rey", "cuadro-rey-torcido", "tapiz-dragones", "estandarte", "mural-completo", "compartimento-abierto", "ranura-con-caliz"]) expect(cat(id), id).toBe("pared");
    for (const id of ["arca-cerrada", "armario-abierto", "brasero-encendido", "trono", "mesa-activa", "sarcofago", "altar-con-agua", "relicario-sellado"]) expect(cat(id), id).toBe("mueble");
  });

  it("los estados abiertos y el brasero encendido bloquean con la caja del estado cerrado; puertas, rejas, pared y suelto no bloquean", () => {
    const real = getModels3DCatalog("medieval-v1")!;
    for (const [open, closed] of [["arca-abierta", "arca-cerrada"], ["armario-abierto", "armario"], ["relicario-abierto", "relicario-sellado"], ["brasero-encendido", "brasero-apagado"]] as const) {
      expect(real.models[open]?.colliders, open).toEqual(real.models[closed]?.colliders);
    }
    for (const [id, model] of Object.entries(real.models)) {
      if (["pared", "suelto"].includes(model.category) || /^(puerta|reja|compuerta|canal|placa)/.test(id) || id === "umbral") {
        if (id !== "umbral") expect(model.colliders, id).toEqual([]);
      }
    }
    expect(real.models["umbral"]?.colliders).toHaveLength(1);   // el umbral del kit conserva su colisionador de antes
  });

  it("un pack sin catálogo devuelve undefined", () => {
    expect(getModels3DCatalog("no-existe")).toBeUndefined();
    expect(getModels3DCatalog("toString")).toBeUndefined();
  });

  it("rechaza una categoría desconocida", () => {
    const bad = structuredClone(catalog);
    (bad.models.arca as { category: string }).category = "otra";
    expect(Models3DCatalogSchema.safeParse(bad).success).toBe(false);
  });
});

describe("resolveModel3D", () => {
  const custom = makeRoom3D().world3d!.models;

  it("prefiere el modelo propio de la sala al del catálogo", () => {
    const own = {
      ...custom,
      arca: {
        ref: "upload:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        label: "Arca propia",
        size: { w: 2, d: 2, hgt: 2 },
        colliders: [],
        clips: [],
      },
    };
    expect(resolveModel3D("arca", catalog, own)?.size).toEqual({ w: 2, d: 2, hgt: 2 });
  });

  it("cae al catálogo si no hay modelo propio", () => {
    expect(resolveModel3D("arca", catalog, custom)).toEqual({
      size: { w: 1, d: 1, hgt: 1 },
      colliders: [],
      clips: ["abrir"],
    });
  });

  it("devuelve undefined si no existe en ninguno", () => {
    expect(resolveModel3D("fantasma", catalog, custom)).toBeUndefined();
    expect(resolveModel3D("arca", undefined, undefined)).toBeUndefined();
    expect(resolveModel3D("constructor", catalog, custom)).toBeUndefined();
  });
});
