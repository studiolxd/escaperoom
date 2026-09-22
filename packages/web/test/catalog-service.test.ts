import { ANONYMOUS_ACTOR } from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { getCatalogService } from "../src/server/services";

describe("composition root de servicios (web)", () => {
  it("lee y valida el fixture del Rey Aldric desde docs/ (sin base de datos)", async () => {
    const room = await getCatalogService().getFeaturedRoom(ANONYMOUS_ACTOR);
    expect(room.id).toBe("room-rey-aldric");
    expect(room.viewer.role).toBe("anonymous");
  });
});
