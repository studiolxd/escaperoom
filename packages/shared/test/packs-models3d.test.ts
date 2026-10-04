import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getModels3DCatalog, Models3DCatalogSchema, resolveModel3D } from "../src/packs";
import type { Models3DCatalog } from "../src/packs";
import { makeRoom3D } from "./fixtures/room-3d";

/** Catálogo de modelos del pack (encargo 7.1a, specs/27 §4). */

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

  it("medieval-v1 trae el kit, los objetos de muestra y el avatar (encargo 7.6p)", () => {
    const real = getModels3DCatalog("medieval-v1")!;
    expect(real.version).toBe("0.1.0");
    expect(Object.keys(real.models)).toHaveLength(22);
    expect(Object.keys(real.avatars)).toEqual(["caballero-m"]);
    expect(real.avatars["caballero-m"]).toMatchObject({
      file: "avatars/caballero-m.glb",
      height: 1.75,
      clips: { idle: "idle", walk: "walk", interact: "interact" },
    });
    for (const [id, model] of Object.entries(real.models)) {
      expect(model.file, id).toBe(`models/${id}.glb`);
      expect(Object.keys(model.label).sort(), id).toEqual(["en", "es"]);
    }
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
