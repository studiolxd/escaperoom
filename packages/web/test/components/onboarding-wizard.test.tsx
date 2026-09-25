// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/lib/analytics-client", () => ({ trackOnboardingStep: vi.fn() }));

vi.mock("@/components/room-editor/playtest-button", () => ({
  PlaytestButton: () => null,
}));

// jsdom no implementa ResizeObserver; lo usa `RadioGroupItem` (Radix) al montar.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

describe("OnboardingWizard (F-7: plantilla de la sala con RadioGroup)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("pinta la elección de plantilla del paso 2 como un RadioGroup accesible, sin radios sueltos", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    await user.click(screen.getByRole("button", { name: "step1.cta" }));

    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
  });

  it("permite cambiar la plantilla elegida haciendo clic en la opción", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await user.click(screen.getByRole("button", { name: "step1.cta" }));

    const radios = screen.getAllByRole("radio");
    const blank = radios[1];
    if (!blank) throw new Error("se esperaban 2 radios");
    await user.click(blank);

    expect(blank).toHaveAttribute("aria-checked", "true");
    expect(radios[0]).toHaveAttribute("aria-checked", "false");
  });
});
