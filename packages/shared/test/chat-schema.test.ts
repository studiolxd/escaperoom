import { describe, expect, it } from "vitest";
import { ChatMessageSchema, ChatPayloadSchema, CHAT_MAX_LENGTH } from "../src/chat";

describe("esquema Zod del chat (specs/11 §4.4)", () => {
  it("acepta un payload válido", () => {
    const result = ChatPayloadSchema.safeParse({ text: "hola" });
    expect(result.success).toBe(true);
  });

  it("rechaza un payload vacío o con texto de otro tipo", () => {
    expect(ChatPayloadSchema.safeParse({ text: "" }).success).toBe(false);
    expect(ChatPayloadSchema.safeParse({ text: 42 }).success).toBe(false);
    expect(ChatPayloadSchema.safeParse({}).success).toBe(false);
  });

  it("rechaza un texto por encima de la longitud máxima", () => {
    const tooLong = "a".repeat(CHAT_MAX_LENGTH + 1);
    expect(ChatPayloadSchema.safeParse({ text: tooLong }).success).toBe(false);
    expect(ChatPayloadSchema.safeParse({ text: "a".repeat(CHAT_MAX_LENGTH) }).success).toBe(true);
  });

  it("valida un mensaje autoritativo completo", () => {
    const message = {
      id: "m-1",
      authorId: "session-a",
      authorName: "Jugador 1",
      text: "hola",
      ts: 1_700_000_000_000,
      filtered: false,
    };
    const result = ChatMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(message);
    }
  });

  it("rechaza un mensaje sin flag de filtrado o con ts inválido", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m-1",
        authorId: "a",
        authorName: "A",
        text: "x",
        ts: 0,
      }).success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({
        id: "m-1",
        authorId: "a",
        authorName: "A",
        text: "x",
        ts: -1,
        filtered: false,
      }).success,
    ).toBe(false);
  });
});
