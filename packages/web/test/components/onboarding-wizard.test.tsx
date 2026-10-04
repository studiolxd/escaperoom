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

const createRoomAction = vi.hoisted(() => vi.fn());
vi.mock("@/actions/onboarding", () => ({ createOnboardingRoomAction: createRoomAction }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
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

  describe("formato 2D/3D (modo 3D)", () => {
    async function toStep2(rooms3dEnabled: boolean) {
      const user = userEvent.setup();
      render(<OnboardingWizard rooms3dEnabled={rooms3dEnabled} />);
      await user.click(screen.getByRole("button", { name: "step1.cta" }));
      return user;
    }

    it("envía dimension 3d con plantilla en blanco y nada con el Rey Aldric", async () => {
      createRoomAction.mockResolvedValue({ ok: true, data: { roomId: "r1", template: "blank" } });
      const user = await toStep2(true);
      await user.click(screen.getAllByRole("radio")[1]!);
      await user.click(screen.getAllByRole("radio")[3]!);
      await user.click(screen.getByRole("button", { name: "step2.cta" }));
      expect(createRoomAction).toHaveBeenLastCalledWith({ template: "blank", dimension: "3d" });
    });

    it("sin el interruptor no aparece el selector de formato", async () => {
      const user = await toStep2(false);
      await user.click(screen.getAllByRole("radio")[1]!);
      expect(screen.getAllByRole("radio")).toHaveLength(2);
      expect(screen.queryByText("step2.dimensionTitle")).not.toBeInTheDocument();
    });

    it("con el interruptor y plantilla en blanco sí aparece; con el Rey Aldric no", async () => {
      const user = await toStep2(true);
      // plantilla por defecto: rey-aldric
      expect(screen.getAllByRole("radio")).toHaveLength(2);
      await user.click(screen.getAllByRole("radio")[1]!);
      expect(screen.getAllByRole("radio")).toHaveLength(4);
      expect(screen.getByText("step2.dimensionTitle")).toBeInTheDocument();
      expect(screen.getByText("step2.dimensionFixed")).toBeInTheDocument();

      await user.click(screen.getAllByRole("radio")[3]!); // 3D
      await user.click(screen.getAllByRole("radio")[0]!); // vuelve al Rey Aldric
      expect(screen.getAllByRole("radio")).toHaveLength(2);
      expect(screen.queryByText("step2.dimensionTitle")).not.toBeInTheDocument();
    });
  });
});
