// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewEventForm } from "@/components/events/new-event-form";

const createMinimalEvent = vi.fn();
const push = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ number: (n: number) => String(n) }),
}));

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/actions/events", () => ({
  createMinimalEvent: (...args: unknown[]) => createMinimalEvent(...args),
}));

describe("NewEventForm", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tiers: [] }), { status: 200 }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    createMinimalEvent.mockClear();
    push.mockClear();
  });

  it("sin título, muestra el error bajo el campo y no llama a la action", async () => {
    const user = userEvent.setup();
    render(<NewEventForm roomVersionId="room-version-1" />);

    await user.clear(screen.getByLabelText("playersLabel"));
    await user.type(screen.getByLabelText("playersLabel"), "10");
    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(await screen.findByText("titleRequired")).toBeInTheDocument();
    expect(createMinimalEvent).not.toHaveBeenCalled();
  });

  it("crea el evento y navega a su panel", async () => {
    createMinimalEvent.mockResolvedValue({ ok: true, data: { id: "event-1" } });
    const user = userEvent.setup();
    render(<NewEventForm roomVersionId="room-version-1" />);

    await user.type(screen.getByLabelText("titleLabel"), "Cumpleaños");
    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(createMinimalEvent).toHaveBeenCalledWith({
      roomVersionId: "room-version-1",
      title: "Cumpleaños",
      playersPlanned: 10,
    });
    expect(push).toHaveBeenCalledWith("/events/event-1");
  });

  it("si la action falla, muestra el error general", async () => {
    createMinimalEvent.mockResolvedValue({
      ok: false,
      error: { code: "SALE_EVENTS_DISABLED", message: "no a la venta" },
    });
    const user = userEvent.setup();
    render(<NewEventForm roomVersionId="room-version-1" />);

    await user.type(screen.getByLabelText("titleLabel"), "Cumpleaños");
    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("submitError");
  });
});
