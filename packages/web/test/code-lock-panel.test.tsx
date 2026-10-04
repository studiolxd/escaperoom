// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodeLockPublicView } from "@escaperoom/shared/templates";
import { CodeLockPanel } from "../src/components/puzzles/code-lock-panel";
import es from "../messages/es.json";

function renderIntl(element: ReactElement) {
  return render(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

function makeView(overrides: Partial<CodeLockPublicView> = {}): CodeLockPublicView {
  return {
    id: "p-candado",
    type: "code_lock",
    length: 4,
    state: "available",
    attempts: 2,
    maxAttempts: 5,
    unlimited: false,
    remainingAttempts: 3,
    lockoutSec: 30,
    lockedUntil: null,
    hints: [],
    solvedAt: null,
    solvedBy: null,
    ...overrides,
  };
}

/**
 * Encargo candado-ilimitado (§3): con `unlimited: true` el panel no debe
 * mostrar "Intentos: X/Y" ni "quedan N intentos".
 */
describe("CodeLockPanel — candado con maxAttempts: 0 (sin límite)", () => {
  afterEach(cleanup);

  it("con límite normal muestra el contador de intentos", () => {
    renderIntl(createElement(CodeLockPanel, { view: makeView(), onAttempt: () => {} }));
    expect(screen.getByText("Intentos: 2/5")).toBeInTheDocument();
  });

  it("sin límite no muestra el máximo de intentos", () => {
    renderIntl(
      createElement(CodeLockPanel, {
        view: makeView({ unlimited: true, maxAttempts: 0 }),
        onAttempt: () => {},
      }),
    );
    expect(screen.queryByText(/\/5/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/0/)).not.toBeInTheDocument();
    expect(screen.getByText("Intentos: 2")).toBeInTheDocument();
  });

  it("sin límite, un fallo no menciona intentos restantes", () => {
    renderIntl(
      createElement(CodeLockPanel, {
        view: makeView({ unlimited: true, maxAttempts: 0 }),
        onAttempt: () => {},
        feedback: "wrong",
      }),
    );
    expect(screen.getByText("Código incorrecto")).toBeInTheDocument();
    expect(screen.queryByText(/intentos/)).not.toBeInTheDocument();
  });

  it("con límite normal, un fallo sí menciona los intentos restantes", () => {
    renderIntl(
      createElement(CodeLockPanel, {
        view: makeView(),
        onAttempt: () => {},
        feedback: "wrong",
      }),
    );
    expect(screen.getByText("Código incorrecto · quedan 3 intentos")).toBeInTheDocument();
  });
});

describe("CodeLockPanel — teclado", () => {
  afterEach(cleanup);

  function setup(overrides: Partial<CodeLockPublicView> = {}, props = {}) {
    const onAttempt = vi.fn();
    renderIntl(
      createElement(CodeLockPanel, { view: makeView({ length: 3, ...overrides }), onAttempt, ...props }),
    );
    return { onAttempt };
  }

  const filled = () => document.querySelectorAll('[data-filled="true"]').length;
  const entered = () =>
    Array.from(document.querySelectorAll('[data-filled="true"]'), (cell) => cell.textContent).join("");

  it("al abrir, el foco va al botón 1 y se muestra la pista", () => {
    setup();
    expect(screen.getByRole("button", { name: "Dígito 1" })).toHaveFocus();
    expect(screen.getByText("También puedes usar el teclado.")).toBeInTheDocument();
  });

  it("las teclas 0–9 (fila superior y numérico) escriben el dígito y no llegan al mundo", () => {
    setup();
    const world = vi.fn();
    window.addEventListener("keydown", world);
    const top = new KeyboardEvent("keydown", { code: "Digit4", key: "4", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(top);
    });
    const pad = new KeyboardEvent("keydown", { code: "Numpad7", key: "7", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(pad);
    });
    window.removeEventListener("keydown", world);
    expect(top.defaultPrevented).toBe(true);
    expect(pad.defaultPrevented).toBe(true);
    expect(world).not.toHaveBeenCalled();
    expect(entered()).toBe("47");
  });

  it("Retroceso borra el último, Supr vacía la entrada", async () => {
    setup();
    const user = userEvent.setup();
    await user.keyboard("123");
    expect(filled()).toBe(3);
    await user.keyboard("{Backspace}");
    expect(filled()).toBe(2);
    await user.keyboard("{Delete}");
    expect(filled()).toBe(0);
  });

  it("Intro envía solo con la entrada completa", async () => {
    const { onAttempt } = setup();
    const user = userEvent.setup();
    await user.keyboard("12{Enter}");
    expect(onAttempt).not.toHaveBeenCalled();
    await user.keyboard("{Backspace}");
    await user.keyboard("{0}");
    await user.keyboard("{Enter}");
    expect(onAttempt).toHaveBeenCalledTimes(1);
  });

  it("con Intro sobre un botón con foco y entrada incompleta, lo pulsa (nativo)", async () => {
    setup();
    const user = userEvent.setup();
    await user.keyboard("{Enter}"); // foco en el 1
    expect(filled()).toBe(1);
  });

  it("ignora el teclado si el foco está en un campo de texto", () => {
    setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const event = new KeyboardEvent("keydown", { code: "Digit5", key: "5", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    input.remove();
    expect(event.defaultPrevented).toBe(false);
    expect(filled()).toBe(0);
  });

  it("deshabilitado (resuelto) no reacciona al teclado", async () => {
    setup({ state: "solved" });
    const user = userEvent.setup();
    await user.keyboard("12");
    expect(filled()).toBe(0);
  });

  it("las flechas mueven el foco por la rejilla de 3 columnas sin dar la vuelta", async () => {
    setup();
    const user = userEvent.setup();
    const btn = (name: string) => screen.getByRole("button", { name });
    expect(btn("Dígito 1")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(btn("Dígito 1")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(btn("Dígito 1")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(btn("Dígito 2")).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(btn("Dígito 3")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(btn("Dígito 6")).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(btn("Retroceder")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(btn("Retroceder")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(btn("Dígito 0")).toHaveFocus();
  });

  it("Espacio pulsa el botón con foco", async () => {
    setup();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}{ }");
    expect(entered()).toBe("2");
  });

  it("con keyboard=false no hay teclado físico ni foco inicial", () => {
    setup({}, { keyboard: false });
    expect(screen.getByRole("button", { name: "Dígito 1" })).not.toHaveFocus();
    const event = new KeyboardEvent("keydown", { code: "Digit5", key: "5", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
