import { describe, expect, it, vi } from "vitest";
import {
  STRIPE_WEBHOOK_EVENT_RETENTION_DAYS,
  purgeStripeWebhookEvents,
  stripeWebhookEventPurgeCutoff,
} from "../src/services/stripe-webhook-purge";

describe("stripeWebhookEventPurgeCutoff", () => {
  it("resta los días dados en UTC", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    expect(stripeWebhookEventPurgeCutoff(now, STRIPE_WEBHOOK_EVENT_RETENTION_DAYS).toISOString()).toBe(
      "2026-08-24T10:00:00.000Z",
    );
  });

  it("por defecto son 30 días", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    expect(stripeWebhookEventPurgeCutoff(now)).toEqual(stripeWebhookEventPurgeCutoff(now, 30));
  });
});

describe("purgeStripeWebhookEvents", () => {
  it("delega en el store con el cutoff calculado", async () => {
    const now = new Date("2026-09-23T10:00:00Z");
    const store = { deleteExpired: vi.fn(async () => 7) };

    const deleted = await purgeStripeWebhookEvents(store, now);

    expect(deleted).toBe(7);
    expect(store.deleteExpired).toHaveBeenCalledWith(stripeWebhookEventPurgeCutoff(now));
  });
});
