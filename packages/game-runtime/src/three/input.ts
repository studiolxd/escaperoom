/** Movimiento del puntero (px) a partir del cual una pulsación es un arrastre y no un clic. */
export const DRAG_THRESHOLD_PX = 6;

/** Clic frente a arrastre (specs/27 §7): menos de 6 px entre pulsar y soltar. */
export function isClick(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) < DRAG_THRESHOLD_PX;
}

/** `true` si el foco está en un campo de texto (copia de `isTypingInFormField` de `room-scene.ts`). */
export function isTypingInFormField(): boolean {
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (!(active instanceof HTMLElement)) return false;
  return active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable;
}

export interface InputCallbacks {
  /** Clic (< 6 px) en coordenadas de cliente. */
  onClick(clientX: number, clientY: number): void;
  /** Arrastre: píxeles desde el último evento. */
  onDrag(dxPx: number, dyPx: number): void;
  /** `steps` > 0 aleja, < 0 acerca. */
  onWheel(steps: number): void;
  /** Puntero sobre el lienzo (`undefined` = ha salido). */
  onHover(clientX: number | undefined, clientY: number | undefined): void;
  /** E o Espacio. */
  onInteractKey(): void;
  /** Se pulsó una tecla de movimiento. */
  onMoveKey(): void;
}

const FORWARD = new Set(["KeyW", "ArrowUp"]);
const BACK = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const INTERACT = new Set(["KeyE", "Space"]);

/** Puntero (clic frente a arrastre), rueda y teclado sobre un elemento. */
export class InputController {
  private readonly pressed = new Set<string>();
  private down: { id: number; x: number; y: number; lastX: number; lastY: number; dragging: boolean } | undefined;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly target: HTMLElement,
    private readonly callbacks: InputCallbacks,
  ) {
    const listen = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn, options);
      this.cleanup.push(() => el.removeEventListener(type, fn, options));
    };

    listen(target, "pointerdown", (e) => {
      if (e.button !== 0) return;
      this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragging: false };
      target.setPointerCapture?.(e.pointerId);
    });
    listen(target, "pointermove", (e) => {
      const d = this.down;
      if (!d || d.id !== e.pointerId) {
        if (!d) this.callbacks.onHover(e.clientX, e.clientY);
        return;
      }
      if (!d.dragging && !isClick({ x: d.x, y: d.y }, { x: e.clientX, y: e.clientY })) {
        d.dragging = true;
        this.callbacks.onHover(undefined, undefined);
        // El primer tramo del arrastre ya cuenta desde el punto de pulsación.
        d.lastX = d.x;
        d.lastY = d.y;
      }
      if (d.dragging) {
        this.callbacks.onDrag(e.clientX - d.lastX, e.clientY - d.lastY);
        d.lastX = e.clientX;
        d.lastY = e.clientY;
      }
    });
    const release = (e: PointerEvent, cancelled: boolean) => {
      const d = this.down;
      if (!d || d.id !== e.pointerId) return;
      this.down = undefined;
      target.releasePointerCapture?.(e.pointerId);
      if (!cancelled && !d.dragging) this.callbacks.onClick(e.clientX, e.clientY);
    };
    listen(target, "pointerup", (e) => release(e, false));
    listen(target, "pointercancel", (e) => release(e, true));
    listen(target, "pointerleave", () => this.callbacks.onHover(undefined, undefined));
    listen(
      target,
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.deltaY !== 0) this.callbacks.onWheel(Math.sign(e.deltaY));
      },
      { passive: false },
    );

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingInFormField() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (INTERACT.has(e.code)) {
        if (!e.repeat) this.callbacks.onInteractKey();
        e.preventDefault();
        return;
      }
      if (FORWARD.has(e.code) || BACK.has(e.code) || LEFT.has(e.code) || RIGHT.has(e.code)) {
        if (!this.pressed.has(e.code)) this.callbacks.onMoveKey();
        this.pressed.add(e.code);
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.pressed.delete(e.code);
    };
    const onBlur = () => this.pressed.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });
  }

  /** Ejes de teclado: `forward` y `right` en [-1, 1] (0 si se anulan o si el foco está en un campo). */
  axes(): { forward: number; right: number } {
    if (isTypingInFormField()) return { forward: 0, right: 0 };
    const any = (set: Set<string>) => [...this.pressed].some((c) => set.has(c));
    return {
      forward: (any(FORWARD) ? 1 : 0) - (any(BACK) ? 1 : 0),
      right: (any(RIGHT) ? 1 : 0) - (any(LEFT) ? 1 : 0),
    };
  }

  clearKeys(): void {
    this.pressed.clear();
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.pressed.clear();
    this.down = undefined;
  }
}
