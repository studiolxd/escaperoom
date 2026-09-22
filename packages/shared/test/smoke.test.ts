import { describe, expect, it } from "vitest";
import { PACKAGE_FORMAT } from "../src/schemas";

describe("shared", () => {
  it("exposes the package format constant", () => {
    expect(PACKAGE_FORMAT).toBe("roompackage/v1");
  });
});
