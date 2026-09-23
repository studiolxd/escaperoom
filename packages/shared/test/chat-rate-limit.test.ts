import { describe, expect, it } from "vitest";
import {
  checkChatRateLimit,
  CHAT_RATE_LIMIT_DEFAULT,
  CHAT_RATE_LIMIT_EMPTY,
  type ChatRateLimitState,
} from "../src/chat";

describe("rate limit del chat 2 msg/s (specs/11 §9)", () => {
  it("acepta dos mensajes y rechaza el tercero dentro de la misma ventana de 1s", () => {
    const first = checkChatRateLimit(CHAT_RATE_LIMIT_EMPTY, 0);
    expect(first.ok).toBe(true);

    const second = checkChatRateLimit(first.state, 400);
    expect(second.ok).toBe(true);

    const third = checkChatRateLimit(second.state, 800);
    expect(third.ok).toBe(false);
    if (third.ok) {
      throw new Error("el tercer mensaje debería rechazarse");
    }
    expect(third.retryAfterMs).toBe(200);
  });

  it("vuelve a aceptar cuando el mensaje más antiguo caduca (ventana deslizante)", () => {
    let state: ChatRateLimitState = CHAT_RATE_LIMIT_EMPTY;
    state = accept(state, 0);
    state = accept(state, 100);

    const atWindowEdge = checkChatRateLimit(state, 999);
    expect(atWindowEdge.ok).toBe(false);

    const afterWindow = checkChatRateLimit(state, 1_000);
    expect(afterWindow.ok).toBe(true);
  });

  it("usa el límite por defecto de 2 por cada 1000 ms", () => {
    expect(CHAT_RATE_LIMIT_DEFAULT).toEqual({ max: 2, windowMs: 1_000 });
  });

  it("respeta una configuración distinta", () => {
    const config = { max: 1, windowMs: 500 };
    const first = checkChatRateLimit(CHAT_RATE_LIMIT_EMPTY, 10, config);
    expect(first.ok).toBe(true);
    expect(checkChatRateLimit(first.state, 200, config).ok).toBe(false);
    expect(checkChatRateLimit(first.state, 510, config).ok).toBe(true);
  });
});

function accept(state: ChatRateLimitState, now: number): ChatRateLimitState {
  const result = checkChatRateLimit(state, now);
  if (!result.ok) {
    throw new Error(`se esperaba aceptar el mensaje en ${now}`);
  }
  return result.state;
}
