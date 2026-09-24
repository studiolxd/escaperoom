// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CatalogFilters,
  type CatalogFilterValues,
} from "@/components/catalog/catalog-filters";

const push = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ number: (value: number) => String(value) }),
}));

vi.mock("@escaperoom/config/locales", () => ({ LOCALES: ["es", "en"] }));

// jsdom no implementa ResizeObserver; lo usa el Slider de Radix al montar.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

function renderFilters(values: CatalogFilterValues = {}) {
  return render(<CatalogFilters values={values} locale="es" />);
}

describe("CatalogFilters", () => {
  beforeEach(() => {
    push.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("no navega al montar", () => {
    renderFilters({});
    vi.advanceTimersByTime(1000);
    expect(push).not.toHaveBeenCalled();
  });

  it("recoge la primera pulsación del buscador (no se pierde, F-8)", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    renderFilters({});

    const search = screen.getByRole("searchbox");
    await user.type(search, "a");
    await vi.advanceTimersByTimeAsync(1000);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ q: "a" }) }),
    );
  });

  it("sincroniza `q` cuando cambian los valores desde fuera sin re-navegar", () => {
    const { rerender } = renderFilters({ q: "inicial" });
    push.mockClear();

    rerender(<CatalogFilters values={{ q: "cambiada" }} locale="es" />);
    vi.advanceTimersByTime(1000);

    expect(screen.getByRole("searchbox")).toHaveValue("cambiada");
    expect(push).not.toHaveBeenCalled();
  });
});
