// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomPlayCta } from "@/components/catalog/room-detail";
import type { CatalogRoom, RoomAccessResult } from "@escaperoom/shared/services";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : JSON.stringify(href)}>{children}</a>
  ),
}));

vi.mock("@/components/catalog/buy-room-button", () => ({
  BuyRoomButton: ({ roomVersionId }: { roomVersionId: string }) => (
    <button type="button" data-testid="buy-room-button">
      buyCta:{roomVersionId}
    </button>
  ),
}));

vi.mock("@/components/catalog/free-room-play-button", () => ({
  FreeRoomPlayButton: ({ roomId }: { roomId: string }) => (
    <button type="button" data-testid="free-room-play-button">
      playFreeCta:{roomId}
    </button>
  ),
}));

const room = {
  id: "room-1",
  latestVersion: { id: "version-1", semver: "1.0.0", publishedAt: "2026-01-01T00:00:00.000Z" },
} as unknown as CatalogRoom;

/**
 * Punto por punto de "CTA Jugar" (`docs/DEUDA.md`, letras c/f/h/i): cada
 * estado del viewer/sala pinta exactamente el botón que le corresponde.
 */
describe("RoomPlayCta", () => {
  afterEach(cleanup);

  it("h) solo para eventos: botón de organizar evento con el roomVersionId", () => {
    render(
      <RoomPlayCta
        room={room}
        locale="es"
        isFree={false}
        isPaid={false}
        isEventsOnly
        access={null}
        isAnonymous
        roomHref="/es/rooms/room-1"
      />,
    );
    const link = screen.getByText("organizeEventCta").closest("a");
    expect(link).toHaveAttribute("href", expect.stringContaining("roomVersionId"));
    expect(link).toHaveAttribute("href", expect.stringContaining("version-1"));
  });

  it("ningún modo de venta: no pinta ningún botón", () => {
    const { container } = render(
      <RoomPlayCta
        room={room}
        locale="es"
        isFree={false}
        isPaid={false}
        isEventsOnly={false}
        access={null}
        isAnonymous
        roomHref="/es/rooms/room-1"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("i) sala gratis: FreeRoomPlayButton, sin distinguir isAnonymous", () => {
    render(
      <RoomPlayCta
        room={room}
        locale="es"
        isFree
        isPaid={false}
        isEventsOnly={false}
        access={null}
        isAnonymous={false}
        roomHref="/es/rooms/room-1"
      />,
    );
    expect(screen.getByTestId("free-room-play-button")).toHaveTextContent("room-1");
  });

  it("c) sala de pago, viewer anónimo: CTA de login con callbackURL a la sala", () => {
    render(
      <RoomPlayCta
        room={room}
        locale="es"
        isFree={false}
        isPaid
        isEventsOnly={false}
        access={null}
        isAnonymous
        roomHref="/es/rooms/room-1"
      />,
    );
    const link = screen.getByText("loginToBuyCta").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/login?callbackURL=" + encodeURIComponent("/es/rooms/room-1"),
    );
  });

  it("sala de pago, autenticado, sin compra: BuyRoomButton", () => {
    render(
      <RoomPlayCta
        room={room}
        locale="es"
        isFree={false}
        isPaid
        isEventsOnly={false}
        access={{ owned: false, playable: false }}
        isAnonymous={false}
        roomHref="/es/rooms/room-1"
      />,
    );
    expect(screen.getByTestId("buy-room-button")).toHaveTextContent("version-1");
  });

  it("f) compra libre: botón Jugar con el gameToken en el fragmento, sin ?join", () => {
    const access: RoomAccessResult = { owned: true, playable: true, gameToken: "tok-abc" };
    render(
      <RoomPlayCta
        room={room}
        locale="es"
        isFree={false}
        isPaid
        isEventsOnly={false}
        access={access}
        isAnonymous={false}
        roomHref="/es/rooms/room-1"
      />,
    );
    const link = screen.getByText("playCta").closest("a");
    expect(link).toHaveAttribute("href", "/es/play/room/room-1#gameToken=tok-abc");
  });

  it("f) compra en curso: botón Reanudar, uniéndose a la room existente", () => {
    const access: RoomAccessResult = {
      owned: true,
      playable: true,
      gameToken: "tok-abc",
      roomId: "colyseus-room-9",
    };
    render(
      <RoomPlayCta
        room={room}
        locale="es"
        isFree={false}
        isPaid
        isEventsOnly={false}
        access={access}
        isAnonymous={false}
        roomHref="/es/rooms/room-1"
      />,
    );
    const link = screen.getByText("resumeCta").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/es/play/room/room-1?join=colyseus-room-9#gameToken=tok-abc",
    );
  });

  it("f) compra consumida: 'ya jugada' + volver a comprar", () => {
    render(
      <RoomPlayCta
        room={room}
        locale="es"
        isFree={false}
        isPaid
        isEventsOnly={false}
        access={{ owned: true, playable: false }}
        isAnonymous={false}
        roomHref="/es/rooms/room-1"
      />,
    );
    expect(screen.getByText("alreadyPlayed")).toBeInTheDocument();
    expect(screen.getByTestId("buy-room-button")).toBeInTheDocument();
  });
});
