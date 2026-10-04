// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { CatalogRoom } from "@escaperoom/shared/services";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomDetailView } from "@/components/catalog/room-detail";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "dimension3d" ? "3D" : key === "dimension2d" ? "2D" : key === "version" ? "v1.0.0" : key,
  useFormatter: () => ({ number: (v: number) => String(v), dateTime: () => "" }),
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/catalog/rating-summary", () => ({ RatingSummary: () => null }));
vi.mock("@/components/catalog/review-form", () => ({ ReviewForm: () => null }));
vi.mock("@/components/catalog/room-cover-upload", () => ({ RoomCoverUpload: () => null }));
vi.mock("@/components/catalog/buy-room-button", () => ({ BuyRoomButton: () => null }));
vi.mock("@/components/catalog/free-room-play-button", () => ({ FreeRoomPlayButton: () => null }));

function renderDetail(dimension: "2d" | "3d") {
  const room = {
    id: "r1",
    title: "Sala de prueba",
    description: "Descripción",
    defaultLanguage: "es",
    dimension,
    difficulty: 1,
    estimatedMinutes: 30,
    priceCents: 0,
    currency: "EUR",
    saleIndividual: false,
    saleEvents: true,
    players: { min: 1, max: 4 },
    languages: ["es"],
    authorDisplayName: "Autor",
    latestVersion: { semver: "1.0.0" },
  } as unknown as CatalogRoom;
  render(
    <RoomDetailView
      room={room}
      locale="es"
      reviewsPromise={Promise.resolve({ reviews: [], total: 0 } as never)}
      viewer={{} as never}
      coverImageUrl={null}
      isAuthor={false}
      access={null}
      isAnonymous
    />,
  );
}

describe("RoomDetailView: etiqueta de formato", () => {
  afterEach(cleanup);

  it.each(["2d", "3d"] as const)("la etiqueta %s es la primera píldora, antes de la versión", (dimension) => {
    renderDetail(dimension);
    const badge = document.querySelector(`[data-dimension="${dimension}"]`) as HTMLElement;
    const version = screen.getByText("v1.0.0");
    expect(badge).toBeInTheDocument();
    expect(badge.parentElement).toBe(version.parentElement);
    expect(badge.parentElement?.firstElementChild).toBe(badge);
  });

  it("el título va suelto, justo debajo de la fila de píldoras", () => {
    renderDetail("3d");
    const title = screen.getByRole("heading", { level: 1, name: "Sala de prueba" });
    const badge = document.querySelector('[data-dimension="3d"]') as HTMLElement;
    expect(title.previousElementSibling).toBe(badge.parentElement);
  });
});
