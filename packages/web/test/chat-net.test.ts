import { describe, expect, it } from "vitest";
import { collectChat, type LobbyStateLike } from "../src/lib/lobby-net";

function fakeState(
  messages: Array<{
    id: string;
    authorId: string;
    authorName: string;
    text: string;
    ts: number;
    filtered: boolean;
  }>,
): LobbyStateLike {
  return {
    players: { forEach: () => undefined },
    chat: { forEach: (callback) => messages.forEach(callback) },
  };
}

describe("collectChat", () => {
  it("copia la ventana de chat en orden de llegada", () => {
    const state = fakeState([
      { id: "1", authorId: "a", authorName: "A", text: "hola", ts: 1, filtered: false },
      { id: "2", authorId: "b", authorName: "B", text: "qué tal", ts: 2, filtered: false },
    ]);
    const chat = collectChat(state);
    expect(chat).toHaveLength(2);
    expect(chat[0]?.text).toBe("hola");
    expect(chat[1]?.authorName).toBe("B");
  });

  it("devuelve vacío si el estado no trae chat", () => {
    expect(collectChat(undefined)).toEqual([]);
    expect(
      collectChat({ players: { forEach: () => undefined } } as unknown as LobbyStateLike),
    ).toEqual([]);
  });
});
