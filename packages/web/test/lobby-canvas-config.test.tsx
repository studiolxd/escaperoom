// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `LobbyCanvas` importa el paquete real `phaser`, que en su módulo de
 * inicialización asume un entorno de navegador con canvas real y no arranca
 * bajo jsdom sin el paquete nativo `canvas` (no instalado a propósito, specs
 * de migración a Phaser 4). Se sustituye por un doble mínimo que solo
 * captura el `GameConfig` pasado a `new Phaser.Game(...)`.
 */
let capturedConfigs: Array<Record<string, unknown>> = [];

vi.mock("phaser", () => {
  class FakeScene {
    constructor(public key?: string) {}
  }
  class FakeGame {
    registry = { set: vi.fn(), remove: vi.fn() };
    destroy = vi.fn();
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

// Sin servidor Colyseus en el test: el `join` no debe intentar red real.
vi.mock("@colyseus/sdk", () => ({
  Client: class {
    joinOrCreate() {
      return new Promise(() => {
        /* nunca se resuelve: basta con montar el canvas para esta prueba */
      });
    }
  },
}));

afterEach(() => {
  cleanup();
  capturedConfigs = [];
});

describe("LobbyCanvas: config de Phaser.Game", () => {
  it("fija roundPixels:true y type:Phaser.AUTO explícitos (v4 cambia el defecto de roundPixels a false)", async () => {
    const { default: LobbyCanvas } = await import("../src/components/game/lobby-canvas");

    const { unmount } = render(<LobbyCanvas />);

    expect(capturedConfigs).toHaveLength(1);
    const [config] = capturedConfigs;
    if (!config) {
      throw new Error("LobbyCanvas no llegó a construir Phaser.Game.");
    }
    expect(config.type).toBe("AUTO");
    expect(config.render).toMatchObject({ roundPixels: true });

    unmount();
  });
});
