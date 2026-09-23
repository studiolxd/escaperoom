import {
  ANONYMOUS_ACTOR,
  buildDraftDoc,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createRoomDraftHandlers } from "../src/server/rest/room-draft";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };

type DraftJson = {
  roomId: string;
  snapshot: { id: string; updatesAppliedThrough: string; state: string } | null;
  updates: Array<{ id: string; authorId: string | null; data: string }>;
};

/** Handlers REST con un store en memoria; el actor viaja en una cabecera de test. */
function setup(snapshotEvery = 100) {
  const store = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
  const drafts = createRoomDraftService({ store, snapshotEvery });
  const actors: Record<string, Actor> = { autora: author, otro: intruder };
  const handlers = createRoomDraftHandlers({
    drafts,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
  });
  const ctx = (roomId = ROOM_ID) => ({ params: Promise.resolve({ roomId }) });
  const url = (path: string) => `http://localhost/api/rooms/${ROOM_ID}/${path}`;

  return {
    getDraft: (user?: string, roomId?: string) =>
      handlers.getDraft(
        new Request(url("draft"), { headers: user ? { "x-test-user": user } : {} }),
        ctx(roomId),
      ),
    postUpdate: (body: Uint8Array, user?: string, contentType = "application/octet-stream") =>
      handlers.postUpdate(
        new Request(url("update"), {
          method: "POST",
          headers: { "content-type": contentType, ...(user ? { "x-test-user": user } : {}) },
          body: Buffer.from(body),
        }),
        ctx(),
      ),
    getHistory: (user?: string) =>
      handlers.getHistory(
        new Request(url("history"), { headers: user ? { "x-test-user": user } : {} }),
        ctx(),
      ),
  };
}

function editorUpdates(n: number) {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => updates.push(u));
  for (let i = 0; i < n; i++) {
    doc.transact(() => {
      doc.getArray<number>("tiles").push([i]);
      doc.getMap("meta").set("title", `Sala ${i}`);
    });
  }
  return { doc, updates };
}

function fromJson(json: DraftJson) {
  return {
    snapshot: json.snapshot
      ? {
          id: BigInt(json.snapshot.id),
          roomId: json.roomId,
          state: new Uint8Array(Buffer.from(json.snapshot.state, "base64")),
          updatesAppliedThrough: BigInt(json.snapshot.updatesAppliedThrough),
          createdAt: new Date(),
        }
      : null,
    updates: json.updates.map((u) => ({
      id: BigInt(u.id),
      roomId: json.roomId,
      data: new Uint8Array(Buffer.from(u.data, "base64")),
      authorId: u.authorId,
      createdAt: new Date(),
    })),
  };
}

describe("REST del draft Yjs (specs/13 §4)", () => {
  it("POST update + GET draft reconstruyen el doc byte a byte (snapshot + updates)", async () => {
    const api = setup(5);
    const { doc, updates } = editorUpdates(12);
    for (const u of updates) {
      const res = await api.postUpdate(u, "autora");
      expect(res.status).toBe(201);
    }

    const res = await api.getDraft("autora");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = (await res.json()) as DraftJson;
    expect(json.snapshot?.updatesAppliedThrough).toBe("10");
    expect(json.updates.map((u) => u.id)).toEqual(["11", "12"]);

    const rebuilt = buildDraftDoc(fromJson(json));
    expect(Buffer.from(Y.encodeStateAsUpdate(rebuilt))).toEqual(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );

    const history = (await (await api.getHistory("autora")).json()) as {
      items: Array<{ updatesAppliedThrough: string }>;
    };
    expect(history.items.map((s) => s.updatesAppliedThrough)).toEqual(["10", "5"]);
  });

  it("otro usuario recibe 403 al leer, escribir o listar el historial", async () => {
    const api = setup();
    const { updates } = editorUpdates(1);
    await api.postUpdate(updates[0]!, "autora");

    for (const res of [
      await api.getDraft("otro"),
      await api.postUpdate(updates[0]!, "otro"),
      await api.getHistory("otro"),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    }
    const own = (await (await api.getDraft("autora")).json()) as DraftJson;
    expect(own.updates).toHaveLength(1);
  });

  it("sin sesión → 401; sala inexistente → 404", async () => {
    const api = setup();
    expect((await api.getDraft()).status).toBe(401);
    expect((await api.getDraft("autora", "33333333-3333-4333-8333-333333333333")).status).toBe(
      404,
    );
  });

  it("update inválido → 422; content-type distinto de octet-stream → 415", async () => {
    const api = setup();
    const bad = await api.postUpdate(new Uint8Array([0xff, 0xff, 0xff]), "autora");
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: { code: "INVALID_UPDATE" } });

    const { updates } = editorUpdates(1);
    const wrongType = await api.postUpdate(updates[0]!, "autora", "application/json");
    expect(wrongType.status).toBe(415);
  });
});
