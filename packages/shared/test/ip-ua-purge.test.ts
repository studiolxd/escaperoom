import { describe, expect, it, vi } from "vitest";
import {
  IP_UA_HASH_RETENTION_DAYS,
  IP_UA_ROW_RETENTION_YEARS,
  hashCutoff,
  hashPurgedValue,
  isIpUaHashDue,
  isPurgedValue,
  isRowDeletionDue,
  rowDeletionCutoff,
  sweepIpUaRetention,
  type IpUaHashCandidate,
} from "../src/services/ip-ua-purge";

const SECRET = "test-secret";

describe("hashCutoff / rowDeletionCutoff", () => {
  it("resta los días/años dados en UTC", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    expect(hashCutoff(now, IP_UA_HASH_RETENTION_DAYS).toISOString()).toBe(
      "2026-06-25T10:00:00.000Z",
    );
    expect(rowDeletionCutoff(now, IP_UA_ROW_RETENTION_YEARS).toISOString()).toBe(
      "2024-09-23T10:00:00.000Z",
    );
  });
});

describe("hashPurgedValue / isPurgedValue", () => {
  it("produce un valor con el prefijo, no reversible y determinista para el mismo secreto", () => {
    const a = hashPurgedValue("203.0.113.7", SECRET, "ip");
    const b = hashPurgedValue("203.0.113.7", SECRET, "ip");
    expect(a).toBe(b);
    expect(isPurgedValue(a)).toBe(true);
    expect(a).not.toContain("203.0.113.7");
  });

  it("distintos dominios dan hashes distintos para el mismo valor y secreto", () => {
    const a = hashPurgedValue("valor", SECRET, "ip");
    const b = hashPurgedValue("valor", SECRET, "ua");
    expect(a).not.toBe(b);
  });

  it("depende del secreto: dos secretos distintos dan hashes distintos", () => {
    const a = hashPurgedValue("valor", "secreto-a", "ip");
    const b = hashPurgedValue("valor", "secreto-b", "ip");
    expect(a).not.toBe(b);
  });

  it("un valor normal no cuenta como ya purgado", () => {
    expect(isPurgedValue("203.0.113.7")).toBe(false);
  });
});

describe("isIpUaHashDue", () => {
  function candidate(overrides: Partial<IpUaHashCandidate> = {}): IpUaHashCandidate {
    return {
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      recordedAt: new Date("2026-01-01T00:00:00Z"),
      ...overrides,
    };
  }

  it("antes del plazo, no toca", () => {
    const justBefore = new Date("2026-01-01T00:00:00Z");
    justBefore.setUTCDate(justBefore.getUTCDate() + IP_UA_HASH_RETENTION_DAYS - 1);
    expect(isIpUaHashDue(candidate(), justBefore)).toBe(false);
  });

  it("al cumplirse el plazo, toca", () => {
    const atDeadline = new Date("2026-01-01T00:00:00Z");
    atDeadline.setUTCDate(atDeadline.getUTCDate() + IP_UA_HASH_RETENTION_DAYS);
    expect(isIpUaHashDue(candidate(), atDeadline)).toBe(true);
  });

  it("sin ip ni user-agent, no hay nada que purgar", () => {
    expect(
      isIpUaHashDue(
        candidate({ ipAddress: null, userAgent: null }),
        new Date("2030-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });

  it("con solo uno de los dos pendiente, toca (el otro ya está purgado o ausente)", () => {
    const already = hashPurgedValue("valor", SECRET, "ip");
    expect(
      isIpUaHashDue(
        candidate({ ipAddress: already, userAgent: null }),
        new Date("2030-01-01T00:00:00Z"),
      ),
    ).toBe(false);
    expect(
      isIpUaHashDue(
        candidate({ ipAddress: already, userAgent: "Mozilla/5.0" }),
        new Date("2030-01-01T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("ambos ya purgados, no vuelve a tocar (idempotencia)", () => {
    const ip = hashPurgedValue("203.0.113.7", SECRET, "ip");
    const ua = hashPurgedValue("Mozilla/5.0", SECRET, "ua");
    expect(
      isIpUaHashDue(candidate({ ipAddress: ip, userAgent: ua }), new Date("2030-01-01T00:00:00Z")),
    ).toBe(false);
  });
});

describe("isRowDeletionDue", () => {
  it("antes de 2 años, no toca; a partir de entonces, sí", () => {
    const recordedAt = new Date("2026-01-01T00:00:00Z");

    const justBefore = new Date(recordedAt);
    justBefore.setUTCFullYear(justBefore.getUTCFullYear() + IP_UA_ROW_RETENTION_YEARS);
    justBefore.setUTCDate(justBefore.getUTCDate() - 1);
    expect(isRowDeletionDue(recordedAt, justBefore)).toBe(false);

    const atDeadline = new Date(recordedAt);
    atDeadline.setUTCFullYear(atDeadline.getUTCFullYear() + IP_UA_ROW_RETENTION_YEARS);
    expect(isRowDeletionDue(recordedAt, atDeadline)).toBe(true);
  });
});

describe("sweepIpUaRetention", () => {
  it("delega en el store (hash y borrado) con el instante y el secreto dados", async () => {
    const now = new Date("2026-09-23T10:00:00Z");
    const store = {
      purgeIpUa: vi.fn(async () => 4),
      deleteExpiredRows: vi.fn(async () => 2),
    };

    const result = await sweepIpUaRetention(store, now, SECRET);

    expect(result).toEqual({ hashed: 4, deleted: 2 });
    expect(store.purgeIpUa).toHaveBeenCalledWith(now, SECRET);
    expect(store.deleteExpiredRows).toHaveBeenCalledWith(now);
  });
});
