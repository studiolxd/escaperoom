// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../../messages/es.json";
import { EventTimeLimitDialog } from "../../src/components/event-panel/event-time-limit-dialog";

const updateEventTimeLimit = vi.fn();
vi.mock("@/actions/events", () => ({ updateEventTimeLimit: (...args: unknown[]) => updateEventTimeLimit(...args) }));

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  updateEventTimeLimit.mockReset();
});

afterEach(() => cleanup());

function renderDialog(props: Partial<Parameters<typeof EventTimeLimitDialog>[0]> = {}) {
  const onSaved = props.onSaved ?? vi.fn();
  render(
    createElement(
      NextIntlClientProvider,
      { locale: "es", messages: es, children: null },
      createElement(EventTimeLimitDialog, {
        eventId: "event-1",
        timeLimitMinutes: undefined,
        ...props,
        onSaved,
      }),
    ),
  );
  return { onSaved };
}

describe("<EventTimeLimitDialog>", () => {
  it("guarda un override en minutos y avisa a onSaved", async () => {
    updateEventTimeLimit.mockResolvedValue({
      ok: true,
      data: { timeLimitMinutes: 90, timeLimitBelowEstimate: false },
    });
    const user = userEvent.setup();
    const { onSaved } = renderDialog();

    await user.click(screen.getByRole("button", { name: /duración del evento: la de la sala/i }));
    const minutes = await screen.findByLabelText("Minutos");
    await user.clear(minutes);
    await user.type(minutes, "90");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateEventTimeLimit).toHaveBeenCalledWith("event-1", 90);
    await screen.findByRole("button", { name: /duración del evento: la de la sala/i });
    expect(onSaved).toHaveBeenCalledWith(90);
  });

  it("marca sin duración y envía null", async () => {
    updateEventTimeLimit.mockResolvedValue({
      ok: true,
      data: { timeLimitMinutes: null, timeLimitBelowEstimate: false },
    });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /duración del evento: la de la sala/i }));
    await user.click(screen.getByRole("switch", { name: "Sin duración (sin límite de tiempo)" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(updateEventTimeLimit).toHaveBeenCalledWith("event-1", null);
  });

  it("muestra el aviso si el override queda por debajo del estimado, sin cerrar el diálogo", async () => {
    updateEventTimeLimit.mockResolvedValue({
      ok: true,
      data: { timeLimitMinutes: 20, timeLimitBelowEstimate: true },
    });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: /duración del evento: la de la sala/i }));
    const minutes = await screen.findByLabelText("Minutos");
    await user.clear(minutes);
    await user.type(minutes, "20");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esta duración es más corta que el tiempo estimado de la sala.",
    );
    // El diálogo sigue abierto (aviso, no bloqueo): el campo de minutos sigue visible.
    expect(screen.getByLabelText("Minutos")).toBeVisible();
  });
});
