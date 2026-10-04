// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomDimensionBadge } from "@/components/catalog/room-dimension-badge";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    key === "dimensionBadgeLabel" ? `Sala en ${values?.dimension}` : key === "dimension3d" ? "3D" : "2D",
}));

describe("RoomDimensionBadge", () => {
  afterEach(cleanup);

  it("pinta «2D» con su aria-label", () => {
    render(<RoomDimensionBadge dimension="2d" />);
    const badge = screen.getByText("2D");
    expect(badge).toHaveAttribute("aria-label", "Sala en 2D");
    expect(badge).toHaveAttribute("data-dimension", "2d");
  });

  it("pinta «3D» con su aria-label", () => {
    render(<RoomDimensionBadge dimension="3d" />);
    const badge = screen.getByText("3D");
    expect(badge).toHaveAttribute("aria-label", "Sala en 3D");
    expect(badge).toHaveAttribute("data-dimension", "3d");
  });
});
