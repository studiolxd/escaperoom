import { describe, expect, it } from "vitest";
import { PACKAGE_FORMAT } from "@escaperoom/shared";

describe("web", () => {
  it("consumes the shared workspace package", () => {
    expect(PACKAGE_FORMAT).toBe("roompackage/v1");
  });
});
