// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { loadRoomPackage, toRuntimeModel } from "@escaperoom/game-runtime";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { RoomPlaytestShell } from "../../src/components/room-playtest/room-playtest-shell";
import { readReyAldricRoomPackageJson } from "../../src/lib/room-preview-fixture";

/**
 * F-17 (auditoría 2026-09-24): mismo overlay de inventario/panel que
 * `game-session-shell.tsx`, convertido igual a `Dialog` de shadcn.
 */

vi.mock("../../src/components/room-playtest/room-playtest-canvas", () => ({
  default: () => null,
}));

const roomPackage = loadRoomPackage(readReyAldricRoomPackageJson());
const model = toRuntimeModel(roomPackage);

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

describe("<RoomPlaytestShell> — F-17", () => {
  it("el inventario es un Dialog con rol, foco atrapado y se cierra con Escape", async () => {
    const user = userEvent.setup();
    renderIntl(createElement(RoomPlaytestShell, { model, roomPackage }));

    // La intro bloquea el juego al montar: la cierra antes de abrir el inventario.
    await user.click(screen.getByTestId("playtest-dialog"));

    await user.click(screen.getByRole("button", { name: /abrir \(i\)/i }));

    const dialog = await screen.findByRole("dialog", { name: /inventario/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /inventario/i })).not.toBeInTheDocument();
  });
});
