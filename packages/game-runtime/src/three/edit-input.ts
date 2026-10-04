import { isClick, isTypingInFormField } from "./input";

export type EditPointerType = "move" | "down" | "up" | "click";

export interface EditPointerInput {
  type: EditPointerType;
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface EditInputCallbacks {
  /** Botón izquierdo sin Espacio: lo consume la herramienta activa. */
  onPointer(event: EditPointerInput): void;
  /** Arrastre que gira la cámara (derecho o central). */
  onOrbit(dxPx: number, dyPx: number): void;
  /** Arrastre que desplaza el pivote (izquierdo + Espacio, o Mayús + derecho). */
  onPan(dxPx: number, dyPx: number): void;
  /** `steps` > 0 aleja, < 0 acerca. */
  onWheel(steps: number): void;
  /** Tecla F. */
  onFocusKey(): void;
  /** Puntero fuera del lienzo. */
  onLeave(): void;
}

type DragKind = "tool" | "orbit" | "pan" | "gizmo";

interface Drag {
  id: number;
  kind: DragKind;
  button: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

/**
 * Entrada del modo edición (specs/27 §8): botón izquierdo = herramientas; derecho/central = gira;
 * Espacio + izquierdo o Mayús + derecho = desplaza; rueda = zoom; F = centrar en la selección.
 *
 * `gizmoActive()` indica si `TransformControls` ha tomado la pulsación: debe registrarse DESPUÉS
 * que los controles para que su `pointerdown` se ejecute antes que el nuestro.
 */
export class EditInput {
  private drag: Drag | undefined;
  private spaceDown = false;
  private hovering = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly target: HTMLElement,
    private readonly callbacks: EditInputCallbacks,
    private readonly gizmoActive: () => boolean,
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

    listen(target, "contextmenu", (e) => e.preventDefault());
    listen(target, "pointerdown", (e) => this.onDown(e));
    listen(target, "pointermove", (e) => this.onMove(e));
    listen(target, "pointerup", (e) => this.onUp(e, false));
    listen(target, "pointercancel", (e) => this.onUp(e, true));
    listen(target, "pointerenter", () => {
      this.hovering = true;
    });
    listen(target, "pointerleave", () => {
      this.hovering = false;
      if (!this.drag) this.callbacks.onLeave();
    });
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
      if (isTypingInFormField()) return;
      if (e.code === "Space") {
        this.spaceDown = true;
        // Solo se secuestra el Espacio (desplazamiento de página) con el puntero sobre el lienzo.
        if (this.hovering || this.drag) e.preventDefault();
        return;
      }
      if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        this.callbacks.onFocusKey();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") this.spaceDown = false;
    };
    const onBlur = () => {
      this.spaceDown = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.drag = undefined;
  }

  private pointer(type: EditPointerType, e: PointerEvent, button: number): EditPointerInput {
    return {
      type,
      clientX: e.clientX,
      clientY: e.clientY,
      button,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    };
  }

  private onDown(e: PointerEvent): void {
    if (this.drag) return;
    let kind: DragKind;
    if (e.button === 0) {
      if (this.gizmoActive()) kind = "gizmo";
      else kind = this.spaceDown ? "pan" : "tool";
    } else if (e.button === 1) {
      kind = "orbit";
    } else if (e.button === 2) {
      kind = e.shiftKey ? "pan" : "orbit";
    } else {
      return;
    }
    this.drag = {
      id: e.pointerId,
      kind,
      button: e.button,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
    this.target.setPointerCapture?.(e.pointerId);
    if (kind === "tool") this.callbacks.onPointer(this.pointer("down", e, e.button));
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) {
      if (!this.gizmoActive()) this.callbacks.onPointer(this.pointer("move", e, e.button));
      return;
    }
    if (d.id !== e.pointerId) return;
    if (!d.moved && !isClick({ x: d.x, y: d.y }, { x: e.clientX, y: e.clientY })) d.moved = true;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (d.kind === "orbit") this.callbacks.onOrbit(dx, dy);
    else if (d.kind === "pan") this.callbacks.onPan(dx, dy);
    else if (d.kind === "tool") this.callbacks.onPointer(this.pointer("move", e, d.button));
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = undefined;
    this.target.releasePointerCapture?.(e.pointerId);
    if (d.kind !== "tool") return;
    this.callbacks.onPointer(this.pointer("up", e, d.button));
    if (!cancelled && !d.moved) this.callbacks.onPointer(this.pointer("click", e, d.button));
  }
}
