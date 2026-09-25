// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewForm } from "@/components/catalog/review-form";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

// jsdom no implementa ResizeObserver; lo usa `RadioGroupItem` (Radix) al montar.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

describe("ReviewForm (F-7: radios de valoración con shadcn/ui)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it("pinta la valoración como un RadioGroup accesible de shadcn/ui (F-7), no radios sueltos", () => {
    render(<ReviewForm roomId="sala-1" initial={{ canReview: true, reason: "ok", review: null }} />);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
  });

  it("permite elegir una valoración por teclado y la envía en el POST", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    const user = userEvent.setup();
    render(
      <ReviewForm roomId="sala-1" initial={{ canReview: true, reason: "ok", review: null }} />,
    );

    const radios = screen.getAllByRole("radio");
    const fourthStar = radios[3];
    if (!fourthStar) throw new Error("se esperaban 5 radios");
    await user.click(fourthStar);
    expect(fourthStar).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: /submit/ }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rooms/sala-1/reviews",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ rating: 4, text: "" }),
      }),
    );
  });
});
