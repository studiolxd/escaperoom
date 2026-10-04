import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputController, type InputCallbacks } from "../../src/three/input";

/** Lienzo de mentira: un `EventTarget` al que se le disparan eventos de puntero sueltos. */
class FakeCanvas extends EventTarget {
  style = {};
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    init: { id: number; x: number; y: number; t?: number; kind?: "touch" | "mouse" },
  ): void {
    const e = new Event(type) as Event & Record<string, unknown>;
    Object.assign(e, {
      pointerId: init.id,
      pointerType: init.kind ?? "touch",
      clientX: init.x,
      clientY: init.y,
      button: 0,
    });
    Object.defineProperty(e, "timeStamp", { value: init.t ?? 0 });
    this.dispatchEvent(e);
  }
}

function setup() {
  const canvas = new FakeCanvas();
  const calls = {
    click: [] as [number, number][],
    drag: [] as [number, number][],
    wheel: [] as number[],
  };
  const callbacks: InputCallbacks = {
    onClick: (x, y) => calls.click.push([x, y]),
    onDrag: (dx, dy) => calls.drag.push([dx, dy]),
    onWheel: (s) => calls.wheel.push(s),
    onHover: () => undefined,
    onInteractKey: () => undefined,
    onMoveKey: () => undefined,
  };
  const input = new InputController(canvas as unknown as HTMLElement, callbacks);
  return { canvas, calls, input };
}

describe("InputController: táctil", () => {
  beforeEach(() => {
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un dedo quieto y soltado en menos de 500 ms es un clic", () => {
    const { canvas, calls } = setup();
    canvas.pointer("pointerdown", { id: 1, x: 100, y: 100, t: 0 });
    canvas.pointer("pointermove", { id: 1, x: 104, y: 103, t: 50 });
    canvas.pointer("pointerup", { id: 1, x: 104, y: 103, t: 200 });
    expect(calls.click).toEqual([[104, 103]]);
    expect(calls.drag).toEqual([]);
  });

  it("un dedo apoyado 500 ms o más no es un clic", () => {
    const { canvas, calls } = setup();
    canvas.pointer("pointerdown", { id: 1, x: 100, y: 100, t: 0 });
    canvas.pointer("pointerup", { id: 1, x: 100, y: 100, t: 500 });
    expect(calls.click).toEqual([]);
  });

  it("un dedo movido 10 px o más gira la cámara y no hace clic", () => {
    const { canvas, calls } = setup();
    canvas.pointer("pointerdown", { id: 1, x: 100, y: 100, t: 0 });
    canvas.pointer("pointermove", { id: 1, x: 105, y: 100, t: 20 }); // 5 px: aún nada
    expect(calls.drag).toEqual([]);
    canvas.pointer("pointermove", { id: 1, x: 112, y: 100, t: 40 });
    canvas.pointer("pointermove", { id: 1, x: 120, y: 104, t: 60 });
    expect(calls.drag).toEqual([
      [12, 0],
      [8, 4],
    ]);
    canvas.pointer("pointerup", { id: 1, x: 120, y: 104, t: 80 });
    expect(calls.click).toEqual([]);
  });

  it("el ratón sigue arrastrando a partir de 6 px", () => {
    const { canvas, calls } = setup();
    canvas.pointer("pointerdown", { id: 1, x: 100, y: 100, kind: "mouse" });
    canvas.pointer("pointermove", { id: 1, x: 107, y: 100, kind: "mouse" });
    expect(calls.drag).toEqual([[7, 0]]);
    canvas.pointer("pointerup", { id: 1, x: 107, y: 100, kind: "mouse" });
    expect(calls.click).toEqual([]);
  });

  it("el pellizco hace un `zoomStep` por cada 40 px de cambio", () => {
    const { canvas, calls } = setup();
    canvas.pointer("pointerdown", { id: 1, x: 100, y: 100, t: 0 });
    canvas.pointer("pointerdown", { id: 2, x: 200, y: 100, t: 5 });
    canvas.pointer("pointermove", { id: 2, x: 230, y: 100 }); // +30: nada
    expect(calls.wheel).toEqual([]);
    canvas.pointer("pointermove", { id: 2, x: 245, y: 100 }); // +45: separar acerca
    expect(calls.wheel).toEqual([-1]);
    canvas.pointer("pointermove", { id: 2, x: 120, y: 100 }); // de 145 a 20: −125 → 3 pasos hacia atrás
    expect(calls.wheel).toEqual([-1, 3]);
    expect(calls.drag).toEqual([]);
  });

  it("tras un pellizco, el dedo que queda no gira ni hace clic", () => {
    const { canvas, calls } = setup();
    canvas.pointer("pointerdown", { id: 1, x: 100, y: 100, t: 0 });
    canvas.pointer("pointerdown", { id: 2, x: 200, y: 100, t: 5 });
    canvas.pointer("pointerup", { id: 2, x: 200, y: 100, t: 100 });
    canvas.pointer("pointermove", { id: 1, x: 160, y: 100 });
    canvas.pointer("pointerup", { id: 1, x: 160, y: 100, t: 150 });
    expect(calls.drag).toEqual([]);
    expect(calls.click).toEqual([]);
    // Con todos los dedos fuera, un toque nuevo vuelve a ser un clic.
    canvas.pointer("pointerdown", { id: 3, x: 50, y: 50, t: 1000 });
    canvas.pointer("pointerup", { id: 3, x: 50, y: 50, t: 1100 });
    expect(calls.click).toEqual([[50, 50]]);
  });

  it("un toque cancelado no es un clic", () => {
    const { canvas, calls } = setup();
    canvas.pointer("pointerdown", { id: 1, x: 100, y: 100, t: 0 });
    canvas.pointer("pointercancel", { id: 1, x: 100, y: 100, t: 100 });
    expect(calls.click).toEqual([]);
  });
});
