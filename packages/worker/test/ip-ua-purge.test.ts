// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { processIpUaPurge } from "../src/ip-ua-purge";

function makeStore(hashed: number, deleted: number) {
  return {
    purgeIpUa: vi.fn(async () => hashed),
    deleteExpiredRows: vi.fn(async () => deleted),
  };
}

describe("processIpUaPurge", () => {
  it("purga session y termsAcceptance con el instante de la pasada y el secreto dado", async () => {
    const now = new Date("2026-09-23T15:00:00Z");
    const session = makeStore(3, 1);
    const termsAcceptance = makeStore(2, 0);

    const result = await processIpUaPurge({ session, termsAcceptance }, "el-secreto", now);

    expect(result).toEqual({
      session: { hashed: 3, deleted: 1 },
      termsAcceptance: { hashed: 2, deleted: 0 },
    });
    expect(session.purgeIpUa).toHaveBeenCalledWith(now, "el-secreto");
    expect(session.deleteExpiredRows).toHaveBeenCalledWith(now);
    expect(termsAcceptance.purgeIpUa).toHaveBeenCalledWith(now, "el-secreto");
    expect(termsAcceptance.deleteExpiredRows).toHaveBeenCalledWith(now);
  });

  it("propaga el error de session para que BullMQ reintente la pasada", async () => {
    const session = {
      purgeIpUa: vi.fn(async () => {
        throw new Error("db caída");
      }),
      deleteExpiredRows: vi.fn(async () => 0),
    };
    const termsAcceptance = makeStore(0, 0);

    await expect(processIpUaPurge({ session, termsAcceptance }, "el-secreto")).rejects.toThrow(
      "db caída",
    );
  });

  it("propaga el error de termsAcceptance para que BullMQ reintente la pasada", async () => {
    const session = makeStore(0, 0);
    const termsAcceptance = {
      purgeIpUa: vi.fn(async () => {
        throw new Error("db caída");
      }),
      deleteExpiredRows: vi.fn(async () => 0),
    };

    await expect(processIpUaPurge({ session, termsAcceptance }, "el-secreto")).rejects.toThrow(
      "db caída",
    );
  });
});
