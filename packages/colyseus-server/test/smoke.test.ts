import { describe, expect, it } from "vitest";
import { GAME_MAX_STEP, GAME_ROOM_NAME } from "../src/index";

describe("colyseus-server", () => {
  it("exposes the game room name and movement cap", () => {
    expect(GAME_ROOM_NAME).toBe("game");
    expect(GAME_MAX_STEP).toBeGreaterThan(0);
  });
});
