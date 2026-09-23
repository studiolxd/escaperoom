// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { processAccessKeyExpiry } from "../src/access-key-expiry";

describe("processAccessKeyExpiry", () => {
  it("aplica las tres reglas de expiryRules con el instante de la pasada", async () => {
    const now = new Date("2026-06-01T15:00:00Z");
    const store = {
      expireByDeadline: vi.fn(async () => 3),
      expireBySessionEnd: vi.fn(async () => 2),
      expireByGroupComplete: vi.fn(async () => 1),
    };

    const result = await processAccessKeyExpiry(store, now);

    expect(result).toEqual({ hoursAfterStart: 3, onSessionEnd: 2, onGroupComplete: 1 });
    expect(store.expireByDeadline).toHaveBeenCalledWith(now);
    expect(store.expireBySessionEnd).toHaveBeenCalledOnce();
    expect(store.expireByGroupComplete).toHaveBeenCalledOnce();
  });

  it("propaga el error para que BullMQ reintente la pasada", async () => {
    const store = {
      expireByDeadline: vi.fn(async () => {
        throw new Error("db caída");
      }),
      expireBySessionEnd: vi.fn(async () => 0),
      expireByGroupComplete: vi.fn(async () => 0),
    };
    await expect(processAccessKeyExpiry(store)).rejects.toThrow("db caída");
    expect(store.expireBySessionEnd).not.toHaveBeenCalled();
  });
});
