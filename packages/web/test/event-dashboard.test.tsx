// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { EventDashboard } from "@escaperoom/shared/services";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "../messages/es.json";
import { EventDashboardView } from "../src/components/event-panel/event-dashboard";

// F-32: el panel del organizador refrescaba cada 5 s aunque la pestaña
// estuviera oculta, y el PDF exportado sin cola creaba un blob URL que
// nunca se revocaba.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const DASHBOARD: EventDashboard = {
  event: {
    id: "event-1",
    title: "Escape de prueba",
    status: "active",
    roomId: "room-1",
    roomVersionId: "version-1",
    requireConfirmation: false,
    playersPlanned: 4,
  },
  keys: { generated: 0, sent: 0, confirmed: 0, redeemed: 0, pendingConfirmation: 0, byStatus: {} },
  invitations: { invited: 0, sent: 0, confirmed: 0, pending: 0, expired: 0 },
  sessions: { total: 0, active: 0, ended: 0, notStarted: 0 },
  metrics: { averageEscapeMs: null, averageHints: null },
  rows: [],
  liveAvailable: true,
  generatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
};

function renderDashboard() {
  return render(
    <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
      <EventDashboardView eventId="event-1" />
    </NextIntlClientProvider>,
  );
}

describe("EventDashboardView — pausa el polling con la pestaña oculta (F-32)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(DASHBOARD), { status: 200 })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("no refresca mientras document.hidden es true; retoma al volver visible", async () => {
    renderDashboard();
    await vi.waitFor(() => expect(screen.getByTestId("event-dashboard")).toBeInTheDocument());
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("EventDashboardView — revoca el blob URL del PDF exportado (F-32)", () => {
  beforeEach(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-1"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("access-keys/export-pdf")) {
          return new Response(new Blob(["pdf"]), { status: 200 });
        }
        return new Response(JSON.stringify(DASHBOARD), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("revoca el blob al desmontar el panel", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("event-dashboard")).toBeInTheDocument());

    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /exportar claves/i }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /descargar el pdf/i })).toBeVisible(),
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    cleanup();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
  });
});
