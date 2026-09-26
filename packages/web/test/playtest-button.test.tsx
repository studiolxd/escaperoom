// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";
import { PlaytestButton } from "../src/components/room-editor/playtest-button";

const mocks = vi.hoisted(() => ({ createPlaytest: vi.fn() }));
vi.mock("@/actions/playtest", () => ({ createPlaytest: mocks.createPlaytest }));

/**
 * F-42: `window.open("about:blank")` conservaba `window.opener` en la
 * pestaña nueva (podía redirigir la de origen, "reverse tabnabbing") y se
 * veía en blanco mientras se creaba la partida.
 */
describe("PlaytestButton — pestaña nueva sin opener y con aviso de carga (F-42)", () => {
  let fakeTab: { opener: unknown; document: Document; location: { href: string } };

  beforeEach(() => {
    fakeTab = {
      opener: window, // simula lo que el navegador pondría por defecto
      document: document.implementation.createHTMLDocument(""),
      location: { href: "" },
    };
    vi.stubGlobal(
      "open",
      vi.fn(() => fakeTab),
    );
    mocks.createPlaytest.mockReset().mockReturnValue(
      new Promise(() => {
        /* nunca resuelve: solo interesa el estado inmediato tras el clic */
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("rompe window.opener y pinta 'Preparando…' en la pestaña nueva", async () => {
    render(
      <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
        <PlaytestButton roomId="sala-1" />
      </NextIntlClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /jugar/i }));

    expect(fakeTab.opener).toBeNull();
    expect(fakeTab.document.body.textContent).toContain("Preparando");
  });
});
