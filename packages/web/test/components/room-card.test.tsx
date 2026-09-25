// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomPrice } from "@/components/catalog/room-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => (key === "free" ? "Gratis" : "Solo para eventos"),
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
