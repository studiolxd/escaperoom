// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor";
import { loadRoomPackage } from "@escaperoom/game-runtime";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";
import { RoomEditorRoomPanel } from "../src/components/room-editor/room-editor-room-panel";
import { resolveEditorPalette } from "../src/lib/editor-palette";
import { readReyAldricRoomPackageJson } from "../src/lib/room-preview-fixture";

/** Radix Select necesita estas APIs, ausentes en jsdom, para abrir su popover. */
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

function renderIntl(element: ReactElement) {
  return render(createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }));
}

const fixture = loadRoomPackage(readReyAldricRoomPackageJson());

function setup(roomId = "salon-trono") {
  const doc = roomPackageToDoc(fixture);
  const pkg = roomDocToPackage(doc);
  const room = pkg.map.rooms.find((r) => r.id === roomId)!;
  const objects = pkg.objects.filter((o) => o.roomId === roomId);
  const { palette } = resolveEditorPalette("medieval-v1");
  const sprites = palette.sprites.map((entry) => entry.sprite);
  return { doc, room, objects, sprites };
}

describe("<RoomEditorRoomPanel> — selectores de sprite y objeto que gobierna la antorcha", () => {
  it("muestra el sprite de cada decoración y el objeto que gobierna cada antorcha", async () => {
    const user = userEvent.setup();
    const { doc, room, objects, sprites } = setup();
    renderIntl(
      createElement(RoomEditorRoomPanel, {
        doc,
        room,
        objects,
        sprites,
        errorText: (error) => error.message,
      }),
    );

    // El Salón ya no tiene decoración suelta: todo es objeto inspeccionable.
    expect(screen.queryAllByLabelText("Sprite")).toHaveLength(room.decorations.length);

    // Antorcha del brasero: el trigger cerrado ya muestra el objeto que la gobierna.
    const governedBy = screen.getByLabelText("Objeto que la gobierna");
    expect(governedBy).toHaveTextContent("brasero");

    // Al abrir, el listbox ofrece el resto de objetos de la habitación.
    await user.click(governedBy);
    const listbox = screen.getByRole("listbox");
    for (const object of objects) {
      expect(within(listbox).getByRole("option", { name: object.id })).toBeInTheDocument();
    }
  });

  it("muestra el sprite de cada decoración de una habitación que aún las tiene", () => {
    const { doc, room, objects, sprites } = setup("catacumbas");
    renderIntl(
      createElement(RoomEditorRoomPanel, {
        doc,
        room,
        objects,
        sprites,
        errorText: (error) => error.message,
      }),
    );
    const decorationSelects = screen.getAllByLabelText("Sprite");
    expect(decorationSelects).toHaveLength(room.decorations.length);
    decorationSelects.forEach((select, index) => {
      expect(select).toHaveTextContent(room.decorations[index]!.sprite);
    });
  });
});
