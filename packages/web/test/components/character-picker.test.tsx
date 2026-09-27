// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { CharacterPicker } from "../../src/components/game-session/character-picker";

/**
 * Encargo retratos: la rejilla de retratos redondos del lobby (sin nombre
 * del propio personaje, sin tarjetas), resaltada con el tinte del jugador,
 * con los personajes ocupados por otro conectado atenuados y con el nombre
 * de quien los tiene.
 */

const pack = {
  baseUrl: "https://cdn.example/pack",
  manifest: {
    avatars: [
      {
        id: "caballero-m",
        label: { es: { text: "Caballero" } },
        portrait: "retrato-caballero-m",
      },
      { id: "mago-f", label: { es: { text: "Maga" } } },
    ],
  },
} as unknown as RoomScenePack;

function renderIntl(element: ReactElement) {
  return render(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

afterEach(() => cleanup());

describe("<CharacterPicker>", () => {
  it("pinta el retrato (o el s-idle de respaldo sin portrait declarado)", () => {
    const { container } = renderIntl(
      createElement(CharacterPicker, {
        pack,
        occupiedBy: new Map(),
        selfTint: "#ff0000",
        onChange: vi.fn(),
      }),
    );
    expect(screen.getByTestId("character-option-caballero-m")).toHaveAccessibleName("Caballero");
    // Retratos decorativos (alt=""): sin rol "img" para el a11y tree, se
    // consultan como elementos <img> normales.
    const portraits = [...container.querySelectorAll("img")].map((img) =>
      img.getAttribute("src"),
    );
    expect(portraits).toContain(
      "https://cdn.example/pack/avatar/caballero-m/retrato-caballero-m.png",
    );
    expect(portraits).toContain("https://cdn.example/pack/avatar/mago-f/avatar-mago-f-s-idle-1.png");
  });

  it("no muestra el nombre del propio personaje debajo del retrato (solo accesible)", () => {
    renderIntl(
      createElement(CharacterPicker, {
        pack,
        occupiedBy: new Map(),
        value: "caballero-m",
        selfTint: "#ff0000",
        onChange: vi.fn(),
      }),
    );
    expect(screen.queryByTestId("character-occupant-caballero-m")).not.toBeInTheDocument();
  });

  it("elegir un personaje llama a onChange con su id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderIntl(
      createElement(CharacterPicker, {
        pack,
        occupiedBy: new Map(),
        selfTint: "#ff0000",
        onChange,
      }),
    );
    await user.click(screen.getByTestId("character-option-mago-f"));
    expect(onChange).toHaveBeenCalledWith("mago-f");
  });

  it("un personaje ocupado por otro jugador conectado se ve deshabilitado, con su nombre y no se puede elegir", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderIntl(
      createElement(CharacterPicker, {
        pack,
        occupiedBy: new Map([["mago-f", { name: "Bruno", tint: "#00ff00" }]]),
        selfTint: "#ff0000",
        onChange,
      }),
    );
    const option = screen.getByTestId("character-option-mago-f");
    expect(option).toBeDisabled();
    expect(option).toHaveAccessibleName("Bruno ya tiene este personaje");
    expect(screen.getByTestId("character-occupant-mago-f")).toHaveTextContent("Bruno");

    await user.click(option);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("si el personaje ocupado es el propio (self.characterId), sigue disponible para él", () => {
    renderIntl(
      createElement(CharacterPicker, {
        pack,
        occupiedBy: new Map([["mago-f", { name: "Ana", tint: "#00ff00" }]]),
        value: "mago-f",
        selfTint: "#ff0000",
        onChange: vi.fn(),
      }),
    );
    expect(screen.getByTestId("character-option-mago-f")).not.toBeDisabled();
  });
});
