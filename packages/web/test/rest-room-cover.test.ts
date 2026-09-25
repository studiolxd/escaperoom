import {
  ANONYMOUS_ACTOR,
  createRoomCoverService,
  type Actor,
  type RoomCoverBlobStore,
  type RoomCoverRoomRef,
  type RoomCoverStore,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createRoomCoverHandlers } from "@/server/rest/room-cover";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function deps(rooms: Record<string, RoomCoverRoomRef>, resolveActor: (r: Request) => Promise<Actor>) {
  const store: RoomCoverStore = {
    async findRoom(roomId) {
      const room = rooms[roomId];
      return room ? { ...room } : null;
    },
    async setCoverImageKey(roomId, key) {
      const room = rooms[roomId];
      if (room) room.coverImageKey = key;
    },
  };
  const blobs: RoomCoverBlobStore = {
    async put() {},
    async delete() {},
    async signedReadUrl(key) {
      return `https://storage.test/${key}`;
    },
  };
  return createRoomCoverHandlers({
    roomCover: createRoomCoverService({ store, blobs }),
    resolveActor,
  });
}

function ctx(roomId: string) {
  return { params: Promise.resolve({ roomId }) };
}

function multipartRequest(file?: { name: string; type: string; bytes: Uint8Array }): Request {
  const form = new FormData();
  if (file) form.set("file", new File([Buffer.from(file.bytes)], file.name, { type: file.type }));
  return new Request("http://localhost/api/rooms/room-1/cover-image", { method: "POST", body: form });
}

describe("server/rest/room-cover (A-12/E-17)", () => {
  it("sin sesión: 401 UNAUTHORIZED, no-store", async () => {
    const handlers = deps({}, async () => ANONYMOUS_ACTOR);
    const res = await handlers.postCoverImage(multipartRequest(), ctx("room-1"));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("sin el campo 'file': 422 VALIDATION_ERROR", async () => {
    const handlers = deps(
      { "room-1": { id: "room-1", authorId: author.userId, coverImageKey: null } },
      async () => author,
    );
    const res = await handlers.postCoverImage(multipartRequest(), ctx("room-1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("sala inexistente: 404 NOT_FOUND", async () => {
    const handlers = deps({}, async () => author);
    const res = await handlers.postCoverImage(
      multipartRequest({ name: "x.png", type: "image/png", bytes: PNG_BYTES }),
      ctx("room-1"),
    );
    expect(res.status).toBe(404);
  });

  it("sube la portada: 200 con coverImageUrl, no-store, el tipo declarado no importa (magic bytes)", async () => {
    const rooms = { "room-1": { id: "room-1", authorId: author.userId, coverImageKey: null } };
    const handlers = deps(rooms, async () => author);
    // Content-Type declarado "text/plain", pero los bytes son un PNG real.
    const res = await handlers.postCoverImage(
      multipartRequest({ name: "x.png", type: "text/plain", bytes: PNG_BYTES }),
      ctx("room-1"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.coverImageUrl).toContain("rooms/room-1/cover.png");
    expect(rooms["room-1"].coverImageKey).toBe("rooms/room-1/cover.png");
  });

  it("cuerpo no multipart: 400 INVALID_JSON", async () => {
    const handlers = deps(
      { "room-1": { id: "room-1", authorId: author.userId, coverImageKey: null } },
      async () => author,
    );
    const res = await handlers.postCoverImage(
      new Request("http://localhost/api/rooms/room-1/cover-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      ctx("room-1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_JSON");
  });
});
