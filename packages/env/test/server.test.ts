import { describe, expect, it } from "vitest";
import {
  creatorChatSchema,
  editorSyncSchema,
  elevenLabsSchema,
  observabilitySchema,
  stripeSchema,
  tokensSchema,
} from "../src/server";

describe("product schema fragments", () => {
  it("editorSyncSchema: todo opcional, sin variables", () => {
    const result = editorSyncSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("editorSyncSchema: coacciona EDITOR_SYNC_PORT a número", () => {
    const result = editorSyncSchema.parse({ EDITOR_SYNC_PORT: "2568" });
    expect(result.EDITOR_SYNC_PORT).toBe(2568);
  });

  it("tokensSchema: todo opcional, sin variables", () => {
    expect(tokensSchema.safeParse({}).success).toBe(true);
  });

  it("tokensSchema: coacciona los TTL a número entero positivo", () => {
    const result = tokensSchema.parse({
      JOIN_TOKEN_TTL_SECONDS: "900",
      PUBLISH_CONFIRM_TTL_SECONDS: "1800",
    });
    expect(result.JOIN_TOKEN_TTL_SECONDS).toBe(900);
    expect(result.PUBLISH_CONFIRM_TTL_SECONDS).toBe(1800);
  });

  it("creatorChatSchema: todo opcional, sin variables", () => {
    expect(creatorChatSchema.safeParse({}).success).toBe(true);
  });

  it("creatorChatSchema: coacciona los topes numéricos", () => {
    const result = creatorChatSchema.parse({
      CREATOR_CHAT_MAX_TURNS: "60",
      CREATOR_CHAT_MAX_TOKENS: "1500000",
    });
    expect(result.CREATOR_CHAT_MAX_TURNS).toBe(60);
    expect(result.CREATOR_CHAT_MAX_TOKENS).toBe(1500000);
  });

  it("observabilitySchema: todo opcional, sin variables", () => {
    expect(observabilitySchema.safeParse({}).success).toBe(true);
  });

  it("elevenLabsSchema: todo opcional, sin variables", () => {
    expect(elevenLabsSchema.safeParse({}).success).toBe(true);
  });

  it("stripeSchema: todo opcional, sin variables", () => {
    expect(stripeSchema.safeParse({}).success).toBe(true);
  });
});
