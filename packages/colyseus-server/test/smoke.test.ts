import { describe, expect, it } from "vitest";
import { GAME_ROOM_NAME } from "../src";

describe("colyseus-server", () => {
  it("exposes the game room name", () => {
    expect(GAME_ROOM_NAME).toBe("game");
  });
});
