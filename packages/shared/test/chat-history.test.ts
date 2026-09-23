import { describe, expect, it } from "vitest";
import { appendChatMessage, CHAT_HISTORY_LIMIT, windowChatHistory } from "../src/chat";

describe("ventana móvil del historial de chat (specs/11 §3)", () => {
  it("conserva como máximo 50 mensajes y descarta los más viejos", () => {
    let history: number[] = [];
    for (let index = 0; index < CHAT_HISTORY_LIMIT; index += 1) {
      history = appendChatMessage(history, index);
    }
    expect(history).toHaveLength(50);
    expect(history[0]).toBe(0);

    history = appendChatMessage(history, 50);
    expect(history).toHaveLength(50);
    expect(history[0]).toBe(1);
    expect(history.at(-1)).toBe(50);
  });

  it("no muta el historial original", () => {
    const original = [1, 2, 3];
    const next = appendChatMessage(original, 4);
    expect(original).toEqual([1, 2, 3]);
    expect(next).toEqual([1, 2, 3, 4]);
  });

  it("recorta un historial ya existente a los últimos 50", () => {
    const big = Array.from({ length: 75 }, (_, index) => index);
    const window = windowChatHistory(big);
    expect(window).toHaveLength(50);
    expect(window[0]).toBe(25);
    expect(window.at(-1)).toBe(74);
  });
});
