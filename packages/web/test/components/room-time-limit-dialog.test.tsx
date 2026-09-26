// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { RoomTimeLimitDialog } from "../../src/components/room-editor/room-time-limit-dialog";
import { readReyAldricRoomPackageJson } from "../../src/lib/room-preview-fixture";

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => cleanup());

function renderIntl(element: ReactElement) {
  return render(createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }));
}

const fixture = loadRoomPackage(readReyAldricRoomPackageJson());

describe("<RoomTimeLimitDialog>", () => {
  it("muestra el límite actual y guarda uno nuevo en el doc al confirmar", async () => {
    const user = userEvent.setup();
    const doc = roomPackageToDoc(fixture);
    const timeLimitMinutes = roomDocToPackage(doc).meta.timeLimitMinutes;
    renderIntl(createElement(RoomTimeLimitDialog, { doc, timeLimitMinutes }));

    const trigger = screen.getByRole("button", { name: /duración/i });
    expect(trigger).toHaveTextContent(`${timeLimitMinutes} min`);
    await user.click(trigger);

    const minutes = await screen.findByLabelText("Minutos");
    await user.clear(minutes);
    await user.type(minutes, "90");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(roomDocToPackage(doc).meta.timeLimitMinutes).toBe(90);
  });

  it("marca 'sin duración' y guarda null en el doc", async () => {
    const user = userEvent.setup();
    const doc = roomPackageToDoc(fixture);
    const timeLimitMinutes = roomDocToPackage(doc).meta.timeLimitMinutes;
    renderIntl(createElement(RoomTimeLimitDialog, { doc, timeLimitMinutes }));

    await user.click(screen.getByRole("button", { name: /duración/i }));
    await user.click(screen.getByRole("switch", { name: "Sin duración (sin límite de tiempo)" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(roomDocToPackage(doc).meta.timeLimitMinutes).toBeNull();
  });

  it("rechaza un valor inválido sin escribir en el doc", async () => {
    const user = userEvent.setup();
    const doc = roomPackageToDoc(fixture);
    const timeLimitMinutes = roomDocToPackage(doc).meta.timeLimitMinutes;
    renderIntl(createElement(RoomTimeLimitDialog, { doc, timeLimitMinutes }));

    await user.click(screen.getByRole("button", { name: /duración/i }));
    const minutes = await screen.findByLabelText("Minutos");
    await user.clear(minutes);
    await user.type(minutes, "0");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La duración debe ser un número entero de minutos mayor que 0",
    );
    expect(roomDocToPackage(doc).meta.timeLimitMinutes).toBe(timeLimitMinutes);
  });
});
