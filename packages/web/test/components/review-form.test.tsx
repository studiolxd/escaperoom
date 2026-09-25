// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewForm } from "@/components/catalog/review-form";

const refresh = vi.fn();
const upsertRoomReview = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/actions/reviews", () => ({
  upsertRoomReview: (...args: unknown[]) => upsertRoomReview(...args),
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
    upsertRoomReview.mockClear();
  });

  it("pinta la valoración como un RadioGroup accesible de shadcn/ui (F-7), con medios puntos (9 zonas)", () => {
    render(
      <ReviewForm roomId="sala-1" initial={{ canReview: true, reason: "ok", review: null }} />,
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    // 1 estrella entera (mínimo, sin medio punto) + 4 estrellas partidas en dos
    // = 9 valores válidos: {1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5}.
    expect(screen.getAllByRole("radio")).toHaveLength(9);
  });

  it("permite elegir un medio punto por teclado y lo envía a la server action", async () => {
    upsertRoomReview.mockResolvedValue({
      ok: true,
      data: { created: true, ratingAvg: 4, ratingCount: 1 },
    });
    const user = userEvent.setup();
    render(
      <ReviewForm roomId="sala-1" initial={{ canReview: true, reason: "ok", review: null }} />,
    );

    const radios = screen.getAllByRole("radio");
    // Orden de las zonas: 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5 — el índice 6 es 4.
    const fourStars = radios[6];
    if (!fourStars) throw new Error("se esperaban 9 radios");
    await user.click(fourStars);
    expect(fourStars).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: /submit/ }));

    expect(upsertRoomReview).toHaveBeenCalledWith("sala-1", { rating: 4, text: "" });
  });

  it("también permite elegir un medio punto exacto (p. ej. 3.5)", async () => {
    upsertRoomReview.mockResolvedValue({
      ok: true,
      data: { created: true, ratingAvg: 3.5, ratingCount: 1 },
    });
    const user = userEvent.setup();
    render(
      <ReviewForm roomId="sala-1" initial={{ canReview: true, reason: "ok", review: null }} />,
    );

    const radios = screen.getAllByRole("radio");
    const threeAndHalf = radios[5];
    if (!threeAndHalf) throw new Error("se esperaban 9 radios");
    await user.click(threeAndHalf);
    await user.click(screen.getByRole("button", { name: /submit/ }));

    expect(upsertRoomReview).toHaveBeenCalledWith("sala-1", { rating: 3.5, text: "" });
  });

  it("sin elegir valoración, muestra el error bajo el campo y no llama a la action", async () => {
    const user = userEvent.setup();
    render(
      <ReviewForm roomId="sala-1" initial={{ canReview: true, reason: "ok", review: null }} />,
    );

    await user.click(screen.getByRole("button", { name: /submit/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ratingRequired");
    expect(upsertRoomReview).not.toHaveBeenCalled();
  });
});
