import { describe, expect, it } from "vitest";
import { EDITOR_MODE } from "../src";

describe("editor", () => {
  it("exposes draft and published modes", () => {
    expect(Object.values(EDITOR_MODE)).toEqual(["draft", "published"]);
  });
});
