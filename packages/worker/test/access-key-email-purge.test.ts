// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { processAccessKeyEmailPurge } from "../src/access-key-email-purge";

describe("processAccessKeyEmailPurge", () => {
  it("purga con el instante de la pasada y el secreto dado", async () => {
    const now = new Date("2026-09-23T15:00:00Z");
    const store = { purgeExpiredEmails: vi.fn(async () => ({ general: 5, educational: 2 })) };

    const result = await processAccessKeyEmailPurge(store, "el-secreto", now);

    expect(result).toEqual({ general: 5, educational: 2 });
    expect(store.purgeExpiredEmails).toHaveBeenCalledWith(now, "el-secreto");
  });

  it("propaga el error para que BullMQ reintente la pasada", async () => {
    const store = {
      purgeExpiredEmails: vi.fn(async () => {
        throw new Error("db caída");
      }),
    };
    await expect(processAccessKeyEmailPurge(store, "el-secreto")).rejects.toThrow("db caída");
  });
});
