// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseConfirmationEmailJob } from "@escaperoom/shared/mail";
import type {
  PendingConfirmations,
  PurchaseConfirmationQueue,
  PurchaseConfirmationStore,
} from "@escaperoom/shared/services";
import {
  DEFAULT_PURCHASE_CONFIRMATION_GRACE_MS,
  DEFAULT_PURCHASE_CONFIRMATION_MAX_AGE_MS,
  DEFAULT_PURCHASE_CONFIRMATION_OUTBOX_LIMIT,
  processPurchaseConfirmationOutbox,
} from "../src/purchase-confirmation-outbox";

const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@escaperoom/kit/logger", () => ({ logger: loggerMock }));

function fakeStore(result: Partial<PendingConfirmations>): PurchaseConfirmationStore {
  return {
    findDetails: async () => null,
    markConfirmationSent: async () => {},
    findPendingConfirmations: async () => ({ pending: [], abandoned: [], ...result }),
  };
}

describe("processPurchaseConfirmationOutbox (E-11)", () => {
  beforeEach(() => {
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
  });

  it("sin pendientes ni abandonados, no reencola ni alerta nada", async () => {
    const confirmations: PurchaseConfirmationQueue = { enqueue: vi.fn(async () => "job-1") };
    const result = await processPurchaseConfirmationOutbox(fakeStore({}), confirmations);
    expect(result).toEqual({ pending: 0, reenqueued: 0, abandoned: 0 });
    expect(confirmations.enqueue).not.toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("reencola cada pendiente y cuenta cuántos lo consiguieron", async () => {
    const jobs: PurchaseConfirmationEmailJob[] = [
      { kind: "room", purchaseId: "p1" },
      { kind: "event_credits", eventId: "e1" },
    ];
    const confirmations: PurchaseConfirmationQueue = { enqueue: vi.fn(async () => "job-x") };
    const result = await processPurchaseConfirmationOutbox(fakeStore({ pending: jobs }), confirmations);
    expect(result).toEqual({ pending: 2, reenqueued: 2, abandoned: 0 });
    expect(confirmations.enqueue).toHaveBeenCalledTimes(2);
    expect(confirmations.enqueue).toHaveBeenCalledWith(jobs[0]);
    expect(confirmations.enqueue).toHaveBeenCalledWith(jobs[1]);
  });

  it("si Redis también está caído al reencolar, cuenta menos reenqueued que pending (sin lanzar)", async () => {
    const jobs: PurchaseConfirmationEmailJob[] = [{ kind: "room", purchaseId: "p1" }];
    const confirmations: PurchaseConfirmationQueue = { enqueue: vi.fn(async () => null) };
    const result = await processPurchaseConfirmationOutbox(fakeStore({ pending: jobs }), confirmations);
    expect(result).toEqual({ pending: 1, reenqueued: 0, abandoned: 0 });
    expect(loggerMock.error).toHaveBeenCalled(); // no todos se reencolaron: es señal de aviso más fuerte.
  });

  it("E-11 (revisión PR #119): lo abandonado NO se reencola y se reporta como error", async () => {
    const abandoned: PurchaseConfirmationEmailJob[] = [{ kind: "room", purchaseId: "viejo" }];
    const confirmations: PurchaseConfirmationQueue = { enqueue: vi.fn(async () => "job-x") };
    const result = await processPurchaseConfirmationOutbox(fakeStore({ abandoned }), confirmations);
    expect(result).toEqual({ pending: 0, reenqueued: 0, abandoned: 1 });
    expect(confirmations.enqueue).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ abandoned: 1 }),
      expect.stringContaining("abandonados"),
    );
  });

  it("usa el margen de gracia y la ventana máxima por defecto al calcular la ventana", async () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const store = {
      ...fakeStore({}),
      findPendingConfirmations: vi.fn(async () => ({ pending: [], abandoned: [] })),
    };
    await processPurchaseConfirmationOutbox(store, { enqueue: vi.fn() }, { now });
    expect(store.findPendingConfirmations).toHaveBeenCalledWith({
      recentCutoff: new Date(now.getTime() - DEFAULT_PURCHASE_CONFIRMATION_GRACE_MS),
      abandonCutoff: new Date(now.getTime() - DEFAULT_PURCHASE_CONFIRMATION_MAX_AGE_MS),
      limit: DEFAULT_PURCHASE_CONFIRMATION_OUTBOX_LIMIT,
    });
  });

  it("acepta un maxAgeMs/limit propios", async () => {
    const now = new Date("2026-09-24T12:00:00Z");
    const store = {
      ...fakeStore({}),
      findPendingConfirmations: vi.fn(async () => ({ pending: [], abandoned: [] })),
    };
    await processPurchaseConfirmationOutbox(
      store,
      { enqueue: vi.fn() },
      { now, maxAgeMs: 60_000, limit: 5 },
    );
    expect(store.findPendingConfirmations).toHaveBeenCalledWith(
      expect.objectContaining({ abandonCutoff: new Date(now.getTime() - 60_000), limit: 5 }),
    );
  });
});
