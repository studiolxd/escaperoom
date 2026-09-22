import { describe, expect, it } from "vitest";
import { MCP_ENDPOINT } from "../src";

describe("mcp-server", () => {
  it("exposes the creator connector endpoint", () => {
    expect(MCP_ENDPOINT).toBe("/mcp/creator");
  });
});
