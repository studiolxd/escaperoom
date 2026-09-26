import { describe, expect, it, vi } from "vitest";
import type { RuntimeModel } from "../src/loader";
import type { RoomScenePack } from "../src/phaser/room-scene";

/**
 * `RoomRuntime` importa el paquete real `phaser`, que en su módulo de
 * inicialización asume un entorno de navegador (`window`/`canvas`) y no se
 * puede cargar en un test Node/jsdom sin instanciar un juego real. Se
 * sustituye por un doble mínimo que solo captura el `GameConfig` pasado a
 * `new Phaser.Game(...)` — suficiente para comprobar la decisión de la
 * migración a v4 (specs de migración) sin arrancar un canvas real.
 */
let capturedConfigs: Array<Record<string, unknown>> = [];

vi.mock("phaser", () => {
  class FakeScene {
    constructor(public key?: string) {}
  }
  class FakeGame {
    constructor(config: Record<string, unknown>) {
      capturedConfigs.push(config);
    }
  }
  return {
    default: {
      AUTO: "AUTO",
      Scale: { RESIZE: "RESIZE", CENTER_BOTH: "CENTER_BOTH" },
      Scene: FakeScene,
      Game: FakeGame,
    },
  };
});

describe("RoomRuntime: config de Phaser.Game", () => {
  it("fija roundPixels:true y type:Phaser.AUTO explícitos (v4 cambia el defecto de roundPixels a false)", async () => {
    capturedConfigs = [];
    const { RoomRuntime } = await import("../src/phaser/room-runtime");

    const model = {
      subrooms: [{ id: "room1" }],
      subroomsById: { room1: { id: "room1" } },
    } as unknown as RuntimeModel;
    const pack = { manifest: {}, baseUrl: "" } as unknown as RoomScenePack;
    const parent = {} as HTMLElement;

    new RoomRuntime(parent, model, { pack });

    expect(capturedConfigs).toHaveLength(1);
    const [config] = capturedConfigs;
    if (!config) {
      throw new Error("RoomRuntime no llegó a construir Phaser.Game.");
    }
    expect(config.type).toBe("AUTO");
    expect(config.render).toMatchObject({ roundPixels: true });
  });
});
