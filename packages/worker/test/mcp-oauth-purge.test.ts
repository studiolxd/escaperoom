// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { processMcpOAuthPurge } from "../src/mcp-oauth-purge";

describe("processMcpOAuthPurge (A-15)", () => {
  it("borra las filas mcp-oauth:* caducadas a la fecha de la pasada", async () => {
    const now = new Date("2026-09-25T10:00:00Z");
    const store = { purgeExpired: vi.fn(async () => 7) };

    const deleted = await processMcpOAuthPurge(store, now);

    expect(deleted).toBe(7);
    expect(store.purgeExpired).toHaveBeenCalledWith(now);
  });

  it("propaga el error para que BullMQ reintente la pasada", async () => {
    const store = {
      purgeExpired: vi.fn(async () => {
        throw new Error("db caída");
      }),
    };

    await expect(processMcpOAuthPurge(store, new Date())).rejects.toThrow("db caída");
  });
});
