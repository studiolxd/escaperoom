import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AtlasCachePort,
  AtlasPreloadPort,
} from "../src/phaser/room-scene";

/**
 * F-43..47 punto 5 (auditoría 2026-09-24): `room-scene.ts` volvía a descargar
 * todos los atlas del pack al remontar el `Phaser.Game` (reintento, cambio de
 * `key` en React), porque cada `Phaser.Game` nuevo trae su propio
 * `TextureManager` vacío. La caché de módulo (`loadedAtlases`, compartida
 * entre instancias) evita el segundo viaje a la red: se prueba aquí contra
 * `planAtlasPreload`/`captureLoadedAtlases` con dobles mínimos de
 * `TextureManager`/`Loader`, sin arrancar un `Phaser.Game` real.
 *
 * `room-scene.ts` importa el paquete real `phaser`, que en su módulo de
 * inicialización asume un entorno de navegador (`window`) y no se puede
 * cargar en un test Node sin instanciarlo (mismo motivo que
 * `room-runtime-config.test.ts`): se sustituye por un doble mínimo.
 */
vi.mock("phaser", () => ({
  default: {
    Scene: class FakeScene {},
    Scale: { Events: { RESIZE: "resize" } },
    Scenes: { Events: { SHUTDOWN: "shutdown" } },
  },
}));

const {
  captureLoadedAtlases,
  clearLoadedAtlasCacheForTests,
  planAtlasPreload,
} = await import("../src/phaser/room-scene");

afterEach(() => {
  clearLoadedAtlasCacheForTests();
});

function fakePreloadPort(existingKeys: Set<string> = new Set()) {
  const loaded: Array<{ key: string; imageUrl: string; dataUrl: string }> = [];
  const added: Array<{ key: string; image: unknown; json: unknown }> = [];
  const port: AtlasPreloadPort = {
    textureExists: (key) => existingKeys.has(key),
    addAtlas: (key, image, json) => {
      added.push({ key, image, json });
      existingKeys.add(key);
    },
    loadAtlas: (key, imageUrl, dataUrl) => {
      loaded.push({ key, imageUrl, dataUrl });
      existingKeys.add(key);
    },
  };
  return { port, loaded, added };
}

function fakeCachePort(textures: Map<string, { image: unknown; json: unknown }>) {
  const port: AtlasCachePort = {
    textureExists: (key) => textures.has(key),
    getTextureImageSource: (key) => textures.get(key)?.image,
    getJson: (key) => textures.get(key)?.json,
  };
  return port;
}

const ATLASES = [{ key: "pack-1", image: "pack-1.png", data: "pack-1.json" }];
const BASE_URL = "https://cdn.example/pack";

describe("planAtlasPreload / captureLoadedAtlases (F-43..47 punto 5)", () => {
  it("la primera vez pide el atlas a la red (sin caché de módulo)", () => {
    const { port, loaded, added } = fakePreloadPort();

    planAtlasPreload(ATLASES, BASE_URL, port);

    expect(loaded).toEqual([
      { key: "pack-1", imageUrl: `${BASE_URL}/pack-1.png`, dataUrl: `${BASE_URL}/pack-1.json` },
    ]);
    expect(added).toEqual([]);
  });

  it("tras `create()` (captureLoadedAtlases), un `Phaser.Game` nuevo no vuelve a pedirlo a la red", () => {
    // Primer montaje: se descarga y, en `create()`, se captura en la caché.
    const fakeImage = { tag: "fake-html-image-element" };
    const fakeJson = { frames: {} };
    const firstMountTextures = new Map([["pack-1", { image: fakeImage, json: fakeJson }]]);
    captureLoadedAtlases(ATLASES, BASE_URL, fakeCachePort(firstMountTextures));

    // Segundo montaje: `Phaser.Game` nuevo, `TextureManager` vacío.
    const { port, loaded, added } = fakePreloadPort();
    planAtlasPreload(ATLASES, BASE_URL, port);

    expect(loaded).toEqual([]);
    expect(added).toEqual([{ key: "pack-1", image: fakeImage, json: fakeJson }]);
  });

  it("si la textura ya existe en el `TextureManager` (misma escena), no llama a `addAtlas` de nuevo", () => {
    const fakeImage = { tag: "fake-html-image-element" };
    const fakeJson = { frames: {} };
    captureLoadedAtlases(
      ATLASES,
      BASE_URL,
      fakeCachePort(new Map([["pack-1", { image: fakeImage, json: fakeJson }]])),
    );

    const { port, loaded, added } = fakePreloadPort(new Set(["pack-1"]));
    planAtlasPreload(ATLASES, BASE_URL, port);

    expect(loaded).toEqual([]);
    expect(added).toEqual([]);
  });

  it("no guarda nada en la caché si la textura o el JSON aún no están listos", () => {
    captureLoadedAtlases(ATLASES, BASE_URL, fakeCachePort(new Map()));

    const { port, loaded } = fakePreloadPort();
    planAtlasPreload(ATLASES, BASE_URL, port);

    // Sin nada capturado, sigue pidiéndolo a la red (comportamiento anterior).
    expect(loaded).toHaveLength(1);
  });
});
