/** Movimiento del puntero (px) a partir del cual una pulsación es un arrastre y no un clic. */
export const DRAG_THRESHOLD_PX = 6;
/** Táctil: movimiento (px) a partir del cual un dedo gira la cámara en vez de tocar. */
export const TOUCH_DRAG_THRESHOLD_PX = 10;
/** Táctil: un toque dura menos de esto (ms). */
export const TOUCH_TAP_MAX_MS = 500;
/** Pellizco: cada tanto cambio (px) en la distancia entre dedos es un `zoomStep`. */
export const PINCH_STEP_PX = 40;

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
  /** Espacio. */
  onInteractKey(): void;
  /** Se pulsó una tecla de movimiento. */
  onMoveKey(): void;
}

const FORWARD = new Set(["KeyW", "ArrowUp"]);
const BACK = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const INTERACT = new Set(["Space"]);

const DOWN = new Set(["KeyQ"]);
const UP = new Set(["KeyE"]);

export interface InputOptions {
  /** Observador: E y Q suben y bajan la cámara libre (no hay interacción ni Espacio). */
  observer?: boolean;
}

interface Touch {
  x: number;
  y: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startAt: number;
}

/** Puntero (ratón y táctil), rueda y teclado sobre un elemento. */
export class InputController {
  private readonly pressed = new Set<string>();
  private down: { id: number; x: number; y: number; lastX: number; lastY: number; dragging: boolean } | undefined;
  private readonly cleanup: (() => void)[] = [];
  private readonly observer: boolean;
  /** Dedos apoyados (`pointerType === "touch"`). */
  private readonly touches = new Map<number, Touch>();
  private touchDragging = false;
  /** Hubo dos dedos: hasta que se suelten todos, ningún dedo gira ni hace clic. */
  private touchMulti = false;
  private pinchBase = 0;

  constructor(
    private readonly target: HTMLElement,
    private readonly callbacks: InputCallbacks,
    options: InputOptions = {},
  ) {
    this.observer = options.observer ?? false;
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
      if (e.pointerType === "touch") {
        this.touchDown(e);
        return;
      }
      this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragging: false };
      target.setPointerCapture?.(e.pointerId);
    });
    listen(target, "pointermove", (e) => {
      if (e.pointerType === "touch") {
        this.touchMove(e);
        return;
      }
      const d = this.down;
      if (!d || d.id !== e.pointerId) return;
      if (!d.dragging && !isClick({ x: d.x, y: d.y }, { x: e.clientX, y: e.clientY })) {
        d.dragging = true;
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
      if (e.pointerType === "touch") {
        this.touchUp(e, cancelled);
        return;
      }
      const d = this.down;
      if (!d || d.id !== e.pointerId) return;
      this.down = undefined;
      target.releasePointerCapture?.(e.pointerId);
      if (!cancelled && !d.dragging) this.callbacks.onClick(e.clientX, e.clientY);
    };
    listen(target, "pointerup", (e) => release(e, false));
    listen(target, "pointercancel", (e) => release(e, true));
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
      if (!this.observer && INTERACT.has(e.code)) {
        if (!e.repeat) this.callbacks.onInteractKey();
        e.preventDefault();
        return;
      }
      const vertical = this.observer && (DOWN.has(e.code) || UP.has(e.code));
      if (
        vertical ||
        FORWARD.has(e.code) ||
        BACK.has(e.code) ||
        LEFT.has(e.code) ||
        RIGHT.has(e.code)
      ) {
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

  /** Eje vertical del observador: E sube (+1), Q baja (−1). */
  vertical(): number {
    if (!this.observer || isTypingInFormField()) return 0;
    const any = (set: Set<string>) => [...this.pressed].some((c) => set.has(c));
    return (any(UP) ? 1 : 0) - (any(DOWN) ? 1 : 0);
  }

  clearKeys(): void {
    this.pressed.clear();
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.pressed.clear();
    this.down = undefined;
    this.touches.clear();
  }

  // ---- táctil: un dedo gira o toca, dos dedos hacen zoom

  private touchDown(e: PointerEvent): void {
    this.target.setPointerCapture?.(e.pointerId);
    this.touches.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      startAt: e.timeStamp,
    });
    if (this.touches.size >= 2) {
      this.touchMulti = true;
      this.pinchBase = this.pinchDistance();
    }
  }

  private touchMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX;
    t.y = e.clientY;
    if (this.touches.size >= 2) {
      const diff = this.pinchDistance() - this.pinchBase;
      const steps = Math.trunc(diff / PINCH_STEP_PX);
      if (steps !== 0) {
        // Separar los dedos acerca (steps < 0 en `onWheel`).
        this.callbacks.onWheel(-steps);
        this.pinchBase += steps * PINCH_STEP_PX;
      }
      return;
    }
    if (this.touchMulti) return;
    if (!this.touchDragging) {
      if (Math.hypot(t.x - t.startX, t.y - t.startY) < TOUCH_DRAG_THRESHOLD_PX) return;
      this.touchDragging = true;
      t.lastX = t.startX;
      t.lastY = t.startY;
    }
    this.callbacks.onDrag(t.x - t.lastX, t.y - t.lastY);
    t.lastX = t.x;
    t.lastY = t.y;
  }

  private touchUp(e: PointerEvent, cancelled: boolean): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    this.target.releasePointerCapture?.(e.pointerId);
    const tap =
      !cancelled &&
      !this.touchDragging &&
      !this.touchMulti &&
      Math.hypot(e.clientX - t.startX, e.clientY - t.startY) < TOUCH_DRAG_THRESHOLD_PX &&
      e.timeStamp - t.startAt < TOUCH_TAP_MAX_MS;
    if (this.touches.size === 0) {
      this.touchDragging = false;
      this.touchMulti = false;
    } else if (this.touches.size === 1) {
      this.pinchBase = 0;
    }
    if (tap) this.callbacks.onClick(e.clientX, e.clientY);
  }

  private pinchDistance(): number {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
