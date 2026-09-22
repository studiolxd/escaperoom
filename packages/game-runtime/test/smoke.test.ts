import { describe, expect, it } from "vitest";
import { RUNTIME_MODE } from "../src";

describe("game-runtime", () => {
  it("exposes play and edit modes", () => {
    expect(Object.values(RUNTIME_MODE)).toEqual(["play", "edit"]);
  });
});
