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
import { RoomPlayersDialog } from "../../src/components/room-editor/room-players-dialog";
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

describe("<RoomPlayersDialog>", () => {
  it("muestra el rango actual y lo guarda en el doc al confirmar", async () => {
    const user = userEvent.setup();
    const doc = roomPackageToDoc(fixture);
    const players = roomDocToPackage(doc).meta.players;
    renderIntl(createElement(RoomPlayersDialog, { doc, players }));

    const trigger = screen.getByRole("button", { name: /jugadores/i });
    expect(trigger).toHaveTextContent(`(${players.min}–${players.max})`);
    await user.click(trigger);

    const min = await screen.findByLabelText("Mínimo");
    const max = screen.getByLabelText("Máximo");
    await user.clear(min);
    await user.type(min, "2");
    await user.clear(max);
    await user.type(max, "3");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(roomDocToPackage(doc).meta.players).toEqual({ min: 2, max: 3 });
  });

  it("avisa si el mínimo supera al máximo, sin escribir en el doc", async () => {
    const user = userEvent.setup();
    const doc = roomPackageToDoc(fixture);
    const players = roomDocToPackage(doc).meta.players;
    renderIntl(createElement(RoomPlayersDialog, { doc, players }));

    await user.click(screen.getByRole("button", { name: /jugadores/i }));
    const min = await screen.findByLabelText("Mínimo");
    const max = screen.getByLabelText("Máximo");
    await user.clear(min);
    await user.type(min, "4");
    await user.clear(max);
    await user.type(max, "2");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El mínimo no puede ser mayor que el máximo",
    );
    expect(roomDocToPackage(doc).meta.players).toEqual(players);
  });
});
