import { describe, expect, it } from "vitest";
import { LOBBY_ROOM_NAME, MAX_STEP_PER_TICK } from "../src/index";

describe("colyseus-server", () => {
  it("exposes the lobby_test room name and movement cap", () => {
    expect(LOBBY_ROOM_NAME).toBe("lobby_test");
    expect(MAX_STEP_PER_TICK).toBeGreaterThan(0);
  });
});
