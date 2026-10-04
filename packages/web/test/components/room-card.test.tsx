// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogRoom } from "@escaperoom/shared/services";
import { RoomCard, RoomPrice } from "@/components/catalog/room-card";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/catalog/rating-summary", () => ({ RatingSummary: () => null }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "free" ? "Gratis" : key === "dimension3d" ? "3D" : key === "dimension2d" ? "2D" : "Solo para eventos",
  useFormatter: () => ({
    number: (value: number, opts?: { style?: string; currency?: string }) =>
      opts?.style === "currency" ? `${value.toFixed(2)} ${opts.currency}` : String(value),
  }),
}));

/**
 * Punto j de "CTA Jugar" (`docs/DEUDA.md`): "Gratis" SOLO con precio 0 y
 * venta individual; precio `null` (sin venta individual) es "Solo para
 * eventos", nunca "Gratis" (antes lo era, aunque la sala no se pudiera jugar).
 */
describe("RoomPrice", () => {
  afterEach(cleanup);

  it("precio 0 + venta individual: Gratis", () => {
    render(<RoomPrice room={{ priceCents: 0, currency: "EUR", saleIndividual: true }} />);
    expect(screen.getByText("Gratis")).toBeInTheDocument();
  });

  it("precio null (sin venta individual): Solo para eventos, NO Gratis", () => {
    render(<RoomPrice room={{ priceCents: null, currency: "EUR", saleIndividual: false }} />);
    expect(screen.getByText("Solo para eventos")).toBeInTheDocument();
    expect(screen.queryByText("Gratis")).not.toBeInTheDocument();
  });

  it("precio 0 pero SIN venta individual: no es Gratis (cae al precio formateado)", () => {
    render(<RoomPrice room={{ priceCents: 0, currency: "EUR", saleIndividual: false }} />);
    expect(screen.queryByText("Gratis")).not.toBeInTheDocument();
  });

  it("precio > 0: importe formateado", () => {
    render(<RoomPrice room={{ priceCents: 199, currency: "EUR", saleIndividual: true }} />);
    expect(screen.getByText("1.99 EUR")).toBeInTheDocument();
  });
});

describe("RoomCard: etiqueta de formato", () => {
  afterEach(cleanup);

  it("la etiqueta 2D/3D aparece antes que el título", () => {
    const room = {
      id: "r1",
      title: "Sala de prueba",
      defaultLanguage: "es",
      dimension: "3d",
      priceCents: 0,
      currency: "EUR",
      saleIndividual: true,
      players: { min: 1, max: 4 },
      languages: ["es"],
      authorDisplayName: "Autor",
    } as unknown as CatalogRoom;
    render(<RoomCard room={room} locale="es" coverImageUrl={null} />);
    const badge = screen.getByText("3D");
    const title = screen.getByRole("heading", { level: 2, name: "Sala de prueba" });
    expect(badge.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.previousElementSibling).toBe(badge);
  });
});
