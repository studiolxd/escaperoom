import { describe, expect, it } from "vitest";
import { bool, emptyStringAsUndefined } from "../src/helpers";

describe("env helpers", () => {
  it("bool parses true/false strings", () => {
    expect(bool(false).parse("true")).toBe(true);
    expect(bool(true).parse("false")).toBe(false);
  });

  it("bool applies its default when unset", () => {
    expect(bool(true).parse(undefined)).toBe(true);
  });

  it("bool acepta '1' como verdadero, coherente con mail/transport.ts (E-21)", () => {
    expect(bool(false).parse("1")).toBe(true);
    expect(bool(true).parse("0")).toBe(false);
  });

  it("emptyStringAsUndefined turns empty strings into undefined", () => {
    expect(emptyStringAsUndefined({ A: "", B: "x" })).toEqual({ A: undefined, B: "x" });
  });
});
