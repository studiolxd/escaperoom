// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { loadRuntimeModel } from "@escaperoom/game-runtime";
import { cleanup, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";
import { readReyAldricRoomPackageJson } from "../src/lib/room-preview-fixture";

/**
 * F-43..47 punto 2 (auditoría 2026-09-24): mientras el jugador rellena el
 * nombre (`NetworkGame`, formulario antes de unirse), se precargan en
 * segundo plano los chunks de Phaser (`game-session-canvas`) y de
 * `livekit-client` (`media-overlay`) para que la partida arranque antes al
 * pulsar entrar.
 */

const canvasLoaded = vi.fn();
const mediaOverlayLoaded = vi.fn();

vi.mock("../src/components/game-session/game-session-canvas", () => {
  canvasLoaded();
  return { default: () => null };
});

vi.mock("../src/components/game/media-overlay", () => {
  mediaOverlayLoaded();
  return { MediaOverlay: () => null };
});

vi.mock("../src/components/game-session/use-game-connection", () => ({
  useGameConnection: () => ({
    client: null,
    status: "connecting" as const,
    roomId: null,
    retry: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  canvasLoaded.mockClear();
  mediaOverlayLoaded.mockClear();
});

const model = loadRuntimeModel(readReyAldricRoomPackageJson());

describe("NetworkGame: precarga de Phaser y livekit-client", () => {
  it("dispara la carga de los dos chunks mientras se muestra el formulario de nombre", async () => {
    const { NetworkGame } = await import("../src/components/game-session/network-game");
    render(
      createElement(NextIntlClientProvider, {
        locale: "es",
        messages: es,
        children: createElement(NetworkGame, { model, target: { kind: "game" } }),
      }),
    );

    await waitFor(() => {
      expect(canvasLoaded).toHaveBeenCalled();
      expect(mediaOverlayLoaded).toHaveBeenCalled();
    });
  });
});
