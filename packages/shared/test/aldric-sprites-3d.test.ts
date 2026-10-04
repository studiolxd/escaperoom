import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getModels3DCatalog } from "../src/packs";

/**
 * Tabla de correspondencia sprite 2D → modelo 3D del Rey Aldric (encargo 7.10a): la usa el conversor 2D→3D (7.10b).
 * Vive en `tools/assets-generator/packs/medieval-v1/modelos3d.json` junto a los metadatos del catálogo.
 */

const leer = (ruta: string) => JSON.parse(readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), "utf8")) as unknown;

const config = leer("../../../tools/assets-generator/packs/medieval-v1/modelos3d.json") as {
  sprites2d: Record<string, { model: string; yaw: number }>;
  sinModelo: string[];
};
const fixture = leer("../../../docs/reference/roompackage-rey-aldric.v1.json") as {
  map: unknown;
  objects: { sprite: string; states: Record<string, string> }[];
};

/** Todos los sprites que usa el fixture 2D: objetos, sprites de sus estados y decoraciones. */
function spritesDelFixture(): Set<string> {
  const sprites = new Set<string>();
  const visitar = (nodo: unknown): void => {
    if (Array.isArray(nodo)) nodo.forEach(visitar);
    else if (nodo && typeof nodo === "object") {
      for (const [clave, valor] of Object.entries(nodo)) {
        if (clave === "decorations" && Array.isArray(valor)) for (const d of valor as { sprite: string }[]) sprites.add(d.sprite);
        else visitar(valor);
      }
    }
  };
  visitar(fixture.map);
  for (const o of fixture.objects) {
    sprites.add(o.sprite);
    for (const s of Object.values(o.states)) sprites.add(s);
  }
  return sprites;
}

describe("sprites 2D del Rey Aldric → modelos 3D", () => {
  const sprites = spritesDelFixture();
  const catalogo = getModels3DCatalog("medieval-v1")!;

  it("el fixture usa sprites (la comprobación no es vacía)", () => {
    expect(sprites.size).toBeGreaterThan(40);
    expect(sprites.has("canal-tramo")).toBe(true);   // decoración
    expect(sprites.has("arca-cerrada-der")).toBe(true);   // estado de un objeto
  });

  it("todo sprite del fixture está en sprites2d o en sinModelo", () => {
    for (const s of sprites) {
      expect(s in config.sprites2d || config.sinModelo.includes(s), s).toBe(true);
    }
  });

  it("`oculto` no se mapea: es el estado «no visible»", () => {
    expect(config.sinModelo).toEqual(["oculto"]);
    expect(config.sprites2d.oculto).toBeUndefined();
  });

  it("cada model de sprites2d existe en el catálogo", () => {
    for (const [sprite, { model }] of Object.entries(config.sprites2d)) {
      expect(catalogo.models[model], `${sprite} → ${model}`).toBeDefined();
    }
  });

  it("el sufijo -der es el mismo modelo girado 90°; el resto, sin giro", () => {
    for (const [sprite, { model, yaw }] of Object.entries(config.sprites2d)) {
      if (sprite.endsWith("-der")) {
        expect(yaw, sprite).toBe(90);
        expect(config.sprites2d[sprite.slice(0, -4)]?.model ?? model, sprite).toBe(model);
      } else expect(yaw, sprite).toBe(0);
    }
  });

  it("las equivalencias fijas del brief", () => {
    const fijas: Record<string, string> = {
      altar: "altar-seco", arca: "arca-cerrada", brasero: "brasero-apagado", "barril-suelto": "barril-cerrado",
      "mesa-catas": "mesa", "placa-piedra": "placa-arriba", "puerta-madera": "puerta-cerrada", reja: "reja-cerrada",
      relicario: "relicario-sellado", "mural-azulejos": "mural-desordenado", "ranura-caliz": "ranura-vacia",
      compartimento: "compartimento-cerrado",
    };
    for (const [sprite, model] of Object.entries(fijas)) {
      if (sprites.has(sprite)) expect(config.sprites2d[sprite]?.model, sprite).toBe(model);
    }
  });
});
