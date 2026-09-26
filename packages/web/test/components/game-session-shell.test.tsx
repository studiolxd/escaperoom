// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { loadRuntimeModel, toPublicRuntimeModel } from "@escaperoom/game-runtime";
import type { GameClient, GameSnapshot } from "@escaperoom/game-runtime/session";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { GameSessionShell } from "../../src/components/game-session/game-session-shell";
import { readReyAldricRoomPackageJson } from "../../src/lib/room-preview-fixture";

/**
 * F-17 (auditoría 2026-09-24): inventario y panel de puzzle/pistas pasan de un
 * `div absolute inset-0` sin semántica a `Dialog` de shadcn — deben exponer
 * `role="dialog"`, atrapar el foco y cerrarse con Escape sin depender del
 * listener global de teclado (que ahora solo cubre el diálogo de inspección).
 */

vi.mock("../../src/components/game-session/game-session-canvas", () => ({
  default: () => null,
}));

const model = toPublicRuntimeModel(loadRuntimeModel(readReyAldricRoomPackageJson()));

function makeSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    selfId: "p1",
    phase: "playing",
    result: "",
    roomPackageId: model.meta.id,
    roomPackageVersion: "1",
    hostId: "p1",
    organizerControlsStart: false,
    clock: 0,
    startedAt: 0,
    endsAt: 0,
    players: [
      {
        id: "p1",
        name: "Ana",
        x: 0,
        y: 0,
        roomId: model.subrooms[0]?.id ?? "",
        tint: "#ffffff",
        characterId: "placeholder",
        connected: true,
        ready: true,
        inMap: true,
        isHost: true,
        isSelf: true,
      },
    ],
    self: {
      id: "p1",
      name: "Ana",
      x: 0,
      y: 0,
      roomId: model.subrooms[0]?.id ?? "",
      tint: "#ffffff",
      characterId: "placeholder",
      connected: true,
      ready: true,
      inMap: true,
      isHost: true,
      isSelf: true,
    },
    objects: {},
    puzzles: {},
    inventory: [],
    inventories: {},
    flags: {},
    chat: [],
    ...overrides,
  };
}

function makeClient(snapshot: GameSnapshot): GameClient {
  const listeners = new Set<(snapshot: GameSnapshot) => void>();
  return {
    selfId: snapshot.selfId,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onEvent: () => () => {},
    leave: async () => {},
    startGame: vi.fn(),
    setReady: vi.fn(),
    enterMap: vi.fn(),
    kick: vi.fn(),
    move: vi.fn(),
    interact: vi.fn(),
    useItem: vi.fn(),
    combine: vi.fn(),
    openPuzzle: vi.fn(),
    closePuzzle: vi.fn(),
    attempt: vi.fn(),
    setPlate: vi.fn(),
    requestSplitView: vi.fn(),
    requestHint: vi.fn(),
    selectCharacter: vi.fn(),
    sendChat: vi.fn(),
    requestMediaToken: vi.fn(),
  };
}

function renderIntl(element: ReactElement) {
  return render(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => cleanup());

describe("<GameSessionShell> — F-17", () => {
  it("el inventario es un Dialog con rol, foco atrapado y se cierra con Escape", async () => {
    const user = userEvent.setup();
    const client = makeClient(makeSnapshot());
    renderIntl(createElement(GameSessionShell, { model, client }));

    await user.click(screen.getByTestId("game-open-inventory"));

    const dialog = await screen.findByRole("dialog", { name: /inventario/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /inventario/i })).not.toBeInTheDocument();
  });

  it("el panel de pistas es un Dialog con rol y se cierra con Escape", async () => {
    const user = userEvent.setup();
    const client = makeClient(makeSnapshot());
    renderIntl(createElement(GameSessionShell, { model, client }));

    const hintsButton = screen.getByRole("button", { name: /pistas/i });
    expect(hintsButton).toBeEnabled();
    await user.click(hintsButton);

    const dialog = await screen.findByRole("dialog", { name: /pistas/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /pistas/i })).not.toBeInTheDocument();
  });
});
