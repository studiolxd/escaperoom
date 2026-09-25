import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_ACTOR,
  createRoomCoverService,
  RoomCoverError,
  type Actor,
  type RoomCoverBlobStore,
  type RoomCoverRoomRef,
  type RoomCoverStore,
} from "../src/services";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const other: Actor = { userId: "otra", organizationId: null, role: "member" };

// PNG magic bytes (89 50 4E 47 0D 0A 1A 0A) + relleno.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const NOT_AN_IMAGE = new Uint8Array([1, 2, 3, 4]);

function fakeStore(rooms: Record<string, RoomCoverRoomRef | undefined>): RoomCoverStore & {
  updated: Array<{ roomId: string; key: string }>;
} {
  const updated: Array<{ roomId: string; key: string }> = [];
  return {
    updated,
    async findRoom(roomId) {
      const room = rooms[roomId];
      return room ? { ...room } : null;
    },
    async setCoverImageKey(roomId, key) {
      updated.push({ roomId, key });
      const room = rooms[roomId];
      if (room) room.coverImageKey = key;
    },
  };
}

function fakeBlobs(): RoomCoverBlobStore & {
  put: RoomCoverBlobStore["put"] & { calls: Array<{ key: string; contentType: string }> };
  deleted: string[];
} {
  const calls: Array<{ key: string; contentType: string }> = [];
  const deleted: string[] = [];
  const put = Object.assign(
    async (key: string, _bytes: Uint8Array, contentType: string) => {
      calls.push({ key, contentType });
    },
    { calls },
  );
  return {
    put,
    async delete(key) {
      deleted.push(key);
    },
    async signedReadUrl(key) {
      return `https://storage.test/${key}?sig=1`;
    },
    deleted,
  };
}

describe("room-cover (A-12/E-17)", () => {
  it("exige sesión", async () => {
    const service = createRoomCoverService({ store: fakeStore({}), blobs: fakeBlobs() });
    await expect(
      service.uploadCoverImage(ANONYMOUS_ACTOR, "room-1", { bytes: PNG_BYTES }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("NOT_FOUND si la sala no existe o está borrada (deletedAt filtrado por el store)", async () => {
    const service = createRoomCoverService({ store: fakeStore({}), blobs: fakeBlobs() });
    await expect(
      service.uploadCoverImage(author, "no-existe", { bytes: PNG_BYTES }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("FORBIDDEN si quien sube no es el autor", async () => {
    const store = fakeStore({
      "room-1": { id: "room-1", authorId: author.userId, coverImageKey: null },
    });
    const service = createRoomCoverService({ store, blobs: fakeBlobs() });
    await expect(
      service.uploadCoverImage(other, "room-1", { bytes: PNG_BYTES }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("PAYLOAD_TOO_LARGE por encima de 5 MB", async () => {
    const store = fakeStore({
      "room-1": { id: "room-1", authorId: author.userId, coverImageKey: null },
    });
    const service = createRoomCoverService({ store, blobs: fakeBlobs() });
    const huge = new Uint8Array(5 * 1024 * 1024 + 1);
    await expect(
      service.uploadCoverImage(author, "room-1", { bytes: huge }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("UNSUPPORTED_MEDIA_TYPE: el tipo se decide por los magic bytes, no por lo que declare quien sube", async () => {
    const store = fakeStore({
      "room-1": { id: "room-1", authorId: author.userId, coverImageKey: null },
    });
    const service = createRoomCoverService({ store, blobs: fakeBlobs() });
    await expect(
      service.uploadCoverImage(author, "room-1", { bytes: NOT_AN_IMAGE }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("sube la portada: putObject -> update -> deleteObject(old), en ese orden", async () => {
    const store = fakeStore({
      "room-1": { id: "room-1", authorId: author.userId, coverImageKey: "rooms/room-1/cover.jpg" },
    });
    const blobs = fakeBlobs();
    const calls: string[] = [];
    const originalPut = blobs.put;
    blobs.put = (async (...args: Parameters<typeof originalPut>) => {
      calls.push("put");
      return originalPut(...args);
    }) as typeof blobs.put;
    const originalDelete = blobs.delete;
    blobs.delete = async (key: string) => {
      calls.push("delete");
      return originalDelete(key);
    };
    const originalSet = store.setCoverImageKey;
    store.setCoverImageKey = async (roomId, key) => {
      calls.push("update");
      return originalSet(roomId, key);
    };

    const service = createRoomCoverService({ store, blobs });
    const result = await service.uploadCoverImage(author, "room-1", { bytes: PNG_BYTES });

    expect(calls).toEqual(["put", "update", "delete"]);
    expect(result.coverImageUrl).toContain("rooms/room-1/cover.png");
    expect(blobs.deleted).toEqual(["rooms/room-1/cover.jpg"]);
    expect(store.updated).toEqual([{ roomId: "room-1", key: "rooms/room-1/cover.png" }]);
  });

  it("primera portada (sin anterior): no intenta borrar nada", async () => {
    const store = fakeStore({
      "room-1": { id: "room-1", authorId: author.userId, coverImageKey: null },
    });
    const blobs = fakeBlobs();
    const service = createRoomCoverService({ store, blobs });
    await service.uploadCoverImage(author, "room-1", { bytes: PNG_BYTES });
    expect(blobs.deleted).toEqual([]);
  });

  it("RoomCoverError expone el código en `.code`", () => {
    const err = new RoomCoverError("NOT_FOUND", "La sala no existe");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("La sala no existe");
  });
});
