import { describe, expect, it, vi } from "vitest";
import {
  DEV_EMAIL_PURGE_SECRET,
  EMAIL_RETENTION_MONTHS,
  hashPurgedEmail,
  isEmailPurgeDue,
  isPurgedEmail,
  purgeAccessKeyEmails,
  purgeCutoff,
  readEmailPurgeSecret,
  type AccessKeyEmailCandidate,
} from "../src/services/access-key-email-purge";

const SECRET = "test-secret";

describe("readEmailPurgeSecret", () => {
  it("E-4: el secreto de desarrollo solo se usa en development/test, nunca por defecto", () => {
    expect(readEmailPurgeSecret({ APP_SECRET: SECRET })).toBe(SECRET);
    expect(readEmailPurgeSecret({ NODE_ENV: "development" })).toBe(DEV_EMAIL_PURGE_SECRET);
    expect(readEmailPurgeSecret({ NODE_ENV: "test" })).toBe(DEV_EMAIL_PURGE_SECRET);
    expect(readEmailPurgeSecret({ NODE_ENV: "production" })).toBeNull();
    expect(readEmailPurgeSecret({})).toBeNull();
    expect(readEmailPurgeSecret({ NODE_ENV: "staging" })).toBeNull();
  });
});

describe("purgeCutoff", () => {
  it("resta los meses dados en UTC", () => {
    const now = new Date("2026-09-23T10:00:00Z");
    expect(purgeCutoff(now, 12).toISOString()).toBe("2025-09-23T10:00:00.000Z");
    expect(purgeCutoff(now, 3).toISOString()).toBe("2026-06-23T10:00:00.000Z");
  });
});

describe("hashPurgedEmail / isPurgedEmail", () => {
  it("produce un valor con el prefijo, no reversible y determinista para el mismo secreto", () => {
    const a = hashPurgedEmail("alumna@centro.example", SECRET);
    const b = hashPurgedEmail("alumna@centro.example", SECRET);
    expect(a).toBe(b);
    expect(isPurgedEmail(a)).toBe(true);
    expect(a).not.toContain("@");
  });

  it("es sensible a mayúsculas del email pero no cambia el resultado (normaliza a minúsculas)", () => {
    const lower = hashPurgedEmail("alumna@centro.example", SECRET);
    const upper = hashPurgedEmail("ALUMNA@CENTRO.example", SECRET);
    expect(lower).toBe(upper);
  });

  it("depende del secreto: dos secretos distintos dan hashes distintos", () => {
    const a = hashPurgedEmail("alumna@centro.example", "secreto-a");
    const b = hashPurgedEmail("alumna@centro.example", "secreto-b");
    expect(a).not.toBe(b);
  });

  it("un email normal no cuenta como ya purgado", () => {
    expect(isPurgedEmail("alumna@centro.example")).toBe(false);
  });
});

describe("isEmailPurgeDue", () => {
  const eventEnded = new Date("2026-01-01T00:00:00Z");

  function candidate(overrides: Partial<AccessKeyEmailCandidate> = {}): AccessKeyEmailCandidate {
    return { email: "p@x.example", audience: "general", eventEndedAt: eventEnded, ...overrides };
  }

  it("sin email, no hay nada que purgar", () => {
    expect(isEmailPurgeDue(candidate({ email: null }), new Date("2030-01-01T00:00:00Z"))).toBe(
      false,
    );
  });

  it("un email ya purgado no se vuelve a tocar (idempotencia)", () => {
    const already = hashPurgedEmail("p@x.example", SECRET);
    expect(
      isEmailPurgeDue(candidate({ email: already }), new Date("2030-01-01T00:00:00Z")),
    ).toBe(false);
  });

  it("sin fin de evento (sesiones aún abiertas o sin sesiones), nunca toca", () => {
    expect(
      isEmailPurgeDue(candidate({ eventEndedAt: null }), new Date("2099-01-01T00:00:00Z")),
    ).toBe(false);
  });

  it("audiencia general: no toca antes de 12 meses y sí a partir de entonces", () => {
    const justBefore = new Date(eventEnded.getTime());
    justBefore.setUTCMonth(justBefore.getUTCMonth() + EMAIL_RETENTION_MONTHS.general);
    justBefore.setUTCDate(justBefore.getUTCDate() - 1);
    expect(isEmailPurgeDue(candidate(), justBefore)).toBe(false);

    const atDeadline = new Date(eventEnded.getTime());
    atDeadline.setUTCMonth(atDeadline.getUTCMonth() + EMAIL_RETENTION_MONTHS.general);
    expect(isEmailPurgeDue(candidate(), atDeadline)).toBe(true);
  });

  it("audiencia educativa: el plazo es de 3 meses, no de 12", () => {
    const at3Months = new Date(eventEnded.getTime());
    at3Months.setUTCMonth(at3Months.getUTCMonth() + EMAIL_RETENTION_MONTHS.educational);

    expect(isEmailPurgeDue(candidate({ audience: "educational" }), at3Months)).toBe(true);
    // Al mismo instante, un evento general todavía no está fuera de plazo.
    expect(isEmailPurgeDue(candidate({ audience: "general" }), at3Months)).toBe(false);
  });
});

describe("purgeAccessKeyEmails", () => {
  it("delega en el store con el instante y el secreto, y devuelve su resultado", async () => {
    const now = new Date("2026-09-23T10:00:00Z");
    const store = {
      purgeExpiredEmails: vi.fn(async () => ({ general: 4, educational: 1 })),
    };

    const result = await purgeAccessKeyEmails(store, now, SECRET);

    expect(result).toEqual({ general: 4, educational: 1 });
    expect(store.purgeExpiredEmails).toHaveBeenCalledWith(now, SECRET);
  });
});
