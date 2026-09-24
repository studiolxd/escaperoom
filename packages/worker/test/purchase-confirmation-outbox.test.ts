// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PurchaseConfirmationEmailJob } from "@escaperoom/shared/mail";
import type { PurchaseConfirmationQueue, PurchaseConfirmationStore } from "@escaperoom/shared/services";
import { processPurchaseConfirmationOutbox } from "../src/purchase-confirmation-outbox";

vi.mock("@escaperoom/kit/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function fakeStore(pending: PurchaseConfirmationEmailJob[]): PurchaseConfirmationStore {
  return {
    findDetails: async () => null,
    markConfirmationSent: async () => {},
    findPendingConfirmations: async () => pending,
  };
}

describe("processPurchaseConfirmationOutbox (E-11)", () => {
  it("sin pendientes, no reencola nada", async () => {
    const confirmations: PurchaseConfirmationQueue = { enqueue: vi.fn(async () => "job-1") };
    const result = await processPurchaseConfirmationOutbox(fakeStore([]), confirmations);
    expect(result).toEqual({ pending: 0, reenqueued: 0 });
    expect(confirmations.enqueue).not.toHaveBeenCalled();
  });

  it("reencola cada pendiente y cuenta cuántos lo consiguieron", async () => {
    const jobs: PurchaseConfirmationEmailJob[] = [
      { kind: "room", purchaseId: "p1" },
      { kind: "event_credits", eventId: "e1" },
    ];
    const confirmations: PurchaseConfirmationQueue = { enqueue: vi.fn(async () => "job-x") };
    const result = await processPurchaseConfirmationOutbox(fakeStore(jobs), confirmations);
    expect(result).toEqual({ pending: 2, reenqueued: 2 });
    expect(confirmations.enqueue).toHaveBeenCalledTimes(2);
    expect(confirmations.enqueue).toHaveBeenCalledWith(jobs[0]);
    expect(confirmations.enqueue).toHaveBeenCalledWith(jobs[1]);
  });

  it("si Redis también está caído al reencolar, cuenta menos reenqueued que pending (sin lanzar)", async () => {
    const jobs: PurchaseConfirmationEmailJob[] = [{ kind: "room", purchaseId: "p1" }];
    const confirmations: PurchaseConfirmationQueue = { enqueue: vi.fn(async () => null) };
    const result = await processPurchaseConfirmationOutbox(fakeStore(jobs), confirmations);
    expect(result).toEqual({ pending: 1, reenqueued: 0 });
  });

  it("usa el margen de gracia por defecto (10 min) al calcular el cutoff", async () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const store = { ...fakeStore([]), findPendingConfirmations: vi.fn(async () => []) };
    await processPurchaseConfirmationOutbox(store, { enqueue: vi.fn() }, { now });
    expect(store.findPendingConfirmations).toHaveBeenCalledWith(new Date("2026-09-24T11:50:00Z"));
  });
});
