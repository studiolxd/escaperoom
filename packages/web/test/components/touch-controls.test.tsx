// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import type { GameSessionCanvasHandle } from "../../src/components/game-session/game-session-canvas";
import {
  TouchControls,
  joystickVector,
} from "../../src/components/game-session/components/touch-controls";

function makeHandle() {
  let highlight: ((objectId: string | undefined) => void) | undefined;
  const handle = {
    setMoveVector: vi.fn(),
    interactHighlighted: vi.fn(() => true),
    onHighlightChange: vi.fn((handler: (objectId: string | undefined) => void) => {
      highlight = handler;
      return () => {
        highlight = undefined;
      };
    }),
  } as unknown as GameSessionCanvasHandle;
  return { handle, highlight: (id: string | undefined) => act(() => highlight?.(id)) };
}

function mockPointer(coarse: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderControls(handle: GameSessionCanvasHandle, active = true) {
  return render(
    createElement(NextIntlClientProvider, {
      locale: "es",
      messages: es,
      children: createElement(TouchControls, {
        handleRef: { current: handle },
        ready: true,
        active,
        objectName: (id: string) => `Objeto ${id}`,
      }),
    }),
  );
}

beforeEach(() => {
  // Base del joystick en (0,0)-(112,112): centro en (56, 56).
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 112,
    bottom: 112,
    width: 112,
    height: 112,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("joystickVector", () => {
  it("normaliza el desplazamiento (y positivo = arriba) y aplica la zona muerta", () => {
    expect(joystickVector(0, 0)).toEqual({ x: 0, y: 0 });
    expect(joystickVector(2, 2)).toEqual({ x: 0, y: 0 });
    expect(joystickVector(16, 0)).toEqual({ x: 0.5, y: -0 });
    expect(joystickVector(0, -32)).toEqual({ x: 0, y: 1 });
    const far = joystickVector(300, -300);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1);
  });
});

describe("<TouchControls> — táctil", () => {
  it("arrastrar el joystick llama a setMoveVector y soltarlo, con null", () => {
    mockPointer(true);
    const { handle } = makeHandle();
    renderControls(handle);
    const joystick = screen.getByTestId("touch-joystick");

    fireEvent.pointerDown(joystick, { pointerId: 1, clientX: 56, clientY: 56 });
    fireEvent.pointerMove(joystick, { pointerId: 1, clientX: 56, clientY: 24 }); // 32 px arriba
    expect(handle.setMoveVector).toHaveBeenLastCalledWith({ x: 0, y: 1 });

    fireEvent.pointerUp(joystick, { pointerId: 1 });
    expect(handle.setMoveVector).toHaveBeenLastCalledWith(null);
  });

  it("el botón Interactuar aparece con un objeto resaltado y llama a interactHighlighted", async () => {
    mockPointer(true);
    const { handle, highlight } = makeHandle();
    renderControls(handle);
    expect(screen.queryByTestId("touch-interact")).not.toBeInTheDocument();

    highlight("brasero");
    const button = await screen.findByRole("button", { name: "Interactuar con Objeto brasero" });
    await userEvent.click(button);
    expect(handle.interactHighlighted).toHaveBeenCalledTimes(1);

    highlight(undefined);
    expect(screen.queryByTestId("touch-interact")).not.toBeInTheDocument();
  });

  it("sin control del mundo (diálogo, panel) no se muestra nada", () => {
    mockPointer(true);
    const { handle } = makeHandle();
    renderControls(handle, false);
    expect(screen.queryByTestId("touch-joystick")).not.toBeInTheDocument();
  });
});

describe("<TouchControls> — escritorio", () => {
  it("sin joystick, botón ni pista de tecla, ni con un objeto resaltado", () => {
    mockPointer(false);
    const { handle, highlight } = makeHandle();
    renderControls(handle);
    expect(screen.queryByTestId("touch-joystick")).not.toBeInTheDocument();
    expect(screen.queryByTestId("touch-hint-key")).not.toBeInTheDocument();

    highlight("brasero");
    expect(screen.queryByTestId("touch-hint-key")).not.toBeInTheDocument();
    expect(screen.queryByTestId("touch-interact")).not.toBeInTheDocument();
  });
});
