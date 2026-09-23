// @vitest-environment node
import {
  createInMemoryModerationStore,
  createModerationService,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { processModerationSampling, readSamplingRate } from "../src/moderation-sampling";

describe("processModerationSampling", () => {
  it("encola en la cola humana lo publicado recientemente, una sola vez", async () => {
    const now = new Date("2026-06-01T06:00:00Z");
    const store = createInMemoryModerationStore({
      versions: [
        {
          roomId: "r1",
          versionId: "v1",
          authorId: "a",
          publishedAt: new Date("2026-05-31T10:00:00Z"),
        },
        {
          roomId: "r2",
          versionId: "v2",
          authorId: "b",
          publishedAt: new Date("2026-04-01T10:00:00Z"),
        },
      ],
      now: () => now,
    });
    const moderation = createModerationService({ store, now: () => now });

    expect(await processModerationSampling(moderation, 1)).toEqual({ considered: 1, enqueued: 1 });
    expect([...store.reports.values()]).toEqual([
      expect.objectContaining({
        source: "sampling",
        severity: "low",
        roomVersionId: "v1",
        status: "pending",
      }),
    ]);
    expect(await processModerationSampling(moderation, 1)).toEqual({ considered: 0, enqueued: 0 });
  });

  it("MODERATION_SAMPLING_RATE: 0–1, por defecto 100 %", () => {
    expect(readSamplingRate({})).toBe(1);
    expect(readSamplingRate({ MODERATION_SAMPLING_RATE: "0.25" })).toBe(0.25);
    expect(readSamplingRate({ MODERATION_SAMPLING_RATE: "7" })).toBe(1);
    expect(readSamplingRate({ MODERATION_SAMPLING_RATE: "nada" })).toBe(1);
  });
});
