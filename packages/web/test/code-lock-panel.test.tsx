// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
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
