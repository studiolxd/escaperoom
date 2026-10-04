// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import type { CombineItemsPublicView } from "@escaperoom/shared/templates";
import { InventoryPanel } from "../../src/components/puzzles/inventory-panel";
import es from "../../messages/es.json";

const view = {
  id: "p-combinar",
  type: "combine_items",
  state: "available",
  inventory: ["a", "b", "c", "d"],
  hints: [],
  solvedAt: null,
  solvedBy: null,
} as unknown as CombineItemsPublicView;

const items = ["a", "b", "c", "d"].map((id) => ({ id, name: `Objeto ${id}` }));

function setup() {
  render(
    <NextIntlClientProvider locale="es" messages={es}>
      <InventoryPanel view={view} items={items} onCombine={() => undefined} cols={3} rows={2} />
    </NextIntlClientProvider>,
  );
}

const option = (id: string) => screen.getByRole("option", { name: `Objeto ${id}` });

afterEach(cleanup);

describe("InventoryPanel — teclado", () => {
  it("al abrir, el foco va al primer ítem", () => {
    setup();
    expect(option("a")).toHaveFocus();
  });

  it("las flechas siguen la rejilla de 3 columnas (arriba/abajo saltan una fila)", async () => {
    setup();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(option("c")).toHaveFocus();
    await user.keyboard("{ArrowRight}"); // fin de fila: se queda
    expect(option("c")).toHaveFocus();
    await user.keyboard("{ArrowDown}"); // no hay ítem debajo (el hueco está vacío)
    expect(option("c")).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowDown}");
    expect(option("d")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(option("a")).toHaveFocus();
  });

  it("Espacio e Intro alternan la selección del ítem con foco", async () => {
    setup();
    const user = userEvent.setup();
    expect(option("a")).toHaveAttribute("aria-selected", "false");
    await user.keyboard("{ }");
    expect(option("a")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(option("a")).toHaveAttribute("aria-selected", "false");
  });
});
