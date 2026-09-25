// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGameReconnect,
  createSeatKey,
  readGameReconnect,
  writeGameReconnect,
} from "@/lib/game-reconnect";

/**
 * Persistencia de reconexión de la `GameRoom` desnuda (C-2, ajuste
 * 2026-09-25): guarda y lee `{ seatKey, reconnectionToken }` por `roomId` en
 * `localStorage` (sobrevive a cerrar y reabrir la pestaña).
 */

beforeEach(() => {
  window.localStorage.clear();
});

describe("game-reconnect", () => {
  it("guarda y recupera la entrada de una room; una room distinta no la ve", () => {
    expect(readGameReconnect("room-1")).toBeNull();
    writeGameReconnect("room-1", { seatKey: "seat-a", reconnectionToken: "tok-1" });
    expect(readGameReconnect("room-1")).toEqual({ seatKey: "seat-a", reconnectionToken: "tok-1" });
    expect(readGameReconnect("room-2")).toBeNull();
  });

  it("sobrescribe la entrada al reconectar (el SDK renueva el token cada vez)", () => {
    writeGameReconnect("room-1", { seatKey: "seat-a", reconnectionToken: "tok-1" });
    writeGameReconnect("room-1", { seatKey: "seat-a", reconnectionToken: "tok-2" });
    expect(readGameReconnect("room-1")).toEqual({ seatKey: "seat-a", reconnectionToken: "tok-2" });
  });

  it("clearGameReconnect borra solo la room pedida", () => {
    writeGameReconnect("room-1", { seatKey: "seat-a", reconnectionToken: "tok-1" });
    writeGameReconnect("room-2", { seatKey: "seat-b", reconnectionToken: "tok-2" });
    clearGameReconnect("room-1");
    expect(readGameReconnect("room-1")).toBeNull();
    expect(readGameReconnect("room-2")).toEqual({ seatKey: "seat-b", reconnectionToken: "tok-2" });
  });

  it("una entrada corrupta o sin seatKey se ignora en vez de lanzar", () => {
    window.localStorage.setItem("escaperoom:game-reconnect:room-1", "{not json");
    expect(readGameReconnect("room-1")).toBeNull();
    window.localStorage.setItem(
      "escaperoom:game-reconnect:room-1",
      JSON.stringify({ reconnectionToken: "tok-1" }),
    );
    expect(readGameReconnect("room-1")).toBeNull();
  });

  it("createSeatKey da valores distintos y no vacíos", () => {
    const a = createSeatKey();
    const b = createSeatKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
