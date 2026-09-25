// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { processStripeWebhookEventPurge } from "../src/stripe-webhook-purge";

describe("processStripeWebhookEventPurge", () => {
  it("borra las filas expiradas con el instante de la pasada", async () => {
    const now = new Date("2026-06-01T15:00:00Z");
    const store = { deleteExpired: vi.fn(async () => 4) };

    const result = await processStripeWebhookEventPurge(store, now);

    expect(result).toBe(4);
    expect(store.deleteExpired).toHaveBeenCalledOnce();
  });

  it("propaga el error para que BullMQ reintente la pasada", async () => {
    const store = {
      deleteExpired: vi.fn(async () => {
        throw new Error("db caída");
      }),
    };
    await expect(processStripeWebhookEventPurge(store)).rejects.toThrow("db caída");
  });
});
