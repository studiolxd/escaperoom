import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES } from "../src/locales";

describe("locales", () => {
  it("includes the default locale", () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it("has unique codes", () => {
    expect(new Set(LOCALES).size).toBe(LOCALES.length);
  });
});
