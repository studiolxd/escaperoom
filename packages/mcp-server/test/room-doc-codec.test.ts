import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { createInMemoryRoomDraftStore, createRoomDraftService } from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readDraftRoomPackage } from "../src/room-draft-reader";
import { ALDRIC_ROOM_ID, AUTHOR, loadAldric } from "./fixtures/drafts";

describe("MCP con la conversión real doc Yjs → RoomPackage (3.1)", () => {
  it("lee el draft del editor como el RoomPackage original", async () => {
    const aldric = parseRoomPackage(loadAldric());
    const drafts = createRoomDraftService({
      store: createInMemoryRoomDraftStore([{ id: ALDRIC_ROOM_ID, authorId: AUTHOR.userId }]),
    });
    const doc = roomPackageToDoc(aldric);
    await drafts.appendUpdate(AUTHOR, ALDRIC_ROOM_ID, Y.encodeStateAsUpdate(doc));

    const pkg = await readDraftRoomPackage({ drafts, roomDocToPackage }, AUTHOR, ALDRIC_ROOM_ID);
    expect(pkg).toEqual(aldric);
  });
});
