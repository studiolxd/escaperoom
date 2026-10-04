import {
  ANONYMOUS_ACTOR,
  createInMemoryIntroMediaBlobStore,
  createInMemoryIntroMediaStore,
  createIntroMediaService,
  type Actor,
} from "@escaperoom/shared/services";
import { MODEL3D_LIMITS } from "@escaperoom/shared/models3d";
import { describe, expect, it } from "vitest";
import { createRoomModelsHandlers } from "@/server/rest/room-models";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ana: Actor = { userId: "ana", organizationId: null, role: "member" };
const bruno: Actor = { userId: "bruno", organizationId: null, role: "member" };

type ErrorJson = { error: { code: string; message: string } };

/** GLB mínimo en memoria: un triángulo con la envolvente indicada. */
function glb(json: Record<string, unknown> = {}): Uint8Array {
  const doc = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ count: 3, componentType: 5126, type: "VEC3", min: [0, 0, 0], max: [1, 2, 3] }],
    ...json,
  };
  const raw = new TextEncoder().encode(JSON.stringify(doc));
  const padded = new Uint8Array(Math.ceil(raw.length / 4) * 4).fill(0x20);
  padded.set(raw);
  const out = new Uint8Array(20 + padded.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, padded.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(padded, 20);
  return out;
}

function setup() {
  const store = createInMemoryIntroMediaStore([{ id: ROOM_ID, authorId: ana.userId }]);
  const blobs = createInMemoryIntroMediaBlobStore();
  const introMedia = createIntroMediaService({ store, blobs });
  const actors: Record<string, Actor> = { ana, bruno };
  const handlers = createRoomModelsHandlers({
    introMedia,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
  });
  const base = `http://localhost/api/rooms/${ROOM_ID}/models`;
  const ctx = { params: Promise.resolve({ roomId: ROOM_ID }) };
  const headers = (user?: string, extra: Record<string, string> = {}) => ({
    ...(user ? { "x-test-user": user } : {}),
    ...extra,
  });
  return {
    store,
    blobs,
    post: (user: string | undefined, body: unknown) =>
      handlers.post(
        new Request(base, {
          method: "POST",
          headers: headers(user, { "content-type": "application/json" }),
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
        ctx,
      ),
    complete: (user: string | undefined, assetId: string) =>
      handlers.postComplete(
        new Request(`${base}/${assetId}/complete`, { method: "POST", headers: headers(user) }),
        { params: Promise.resolve({ roomId: ROOM_ID, assetId }) },
      ),
    getUrl: (user: string | undefined, ref: string | null) =>
      handlers.getUrl(
        new Request(`${base}/url${ref === null ? "" : `?ref=${encodeURIComponent(ref)}`}`, {
          headers: headers(user),
        }),
        ctx,
      ),
  };
}

const body = (byteSize: number) => ({
  filename: "arca.glb",
  contentType: "model/gltf-binary",
  byteSize,
});

describe("REST /api/rooms/:roomId/models", () => {
  it("201 {assetId, uploadUrl, headers} → PUT → complete 200 con las medidas → url", async () => {
    const t = setup();
    const model = glb();
    const res = await t.post("ana", body(model.byteLength));
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const ticket = (await res.json()) as {
      assetId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };
    expect(Object.keys(ticket).sort()).toEqual(["assetId", "headers", "uploadUrl"]);
    expect(ticket.headers).toEqual({ "Content-Type": "model/gltf-binary" });

    const early = await t.complete("ana", ticket.assetId);
    expect(early.status).toBe(409);
    expect(((await early.json()) as ErrorJson).error.code).toBe("UPLOAD_INCOMPLETE");

    t.blobs.simulatePut(t.store.rows.get(ticket.assetId)!.storageKey, model, "model/gltf-binary");
    const done = await t.complete("ana", ticket.assetId);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({
      ref: `media:${ticket.assetId}`,
      triangles: 1,
      byteSize: model.byteLength,
      size: { w: 1, d: 3, hgt: 2 },
      clips: [],
    });

    const url = await t.getUrl("ana", `media:${ticket.assetId}`);
    expect(url.status).toBe(200);
    expect(((await url.json()) as { url: string }).url).toContain(".glb");
  });

  it("anónimo → 401; no autor → 403 (también en complete y url)", async () => {
    const t = setup();
    const ok = body(10);
    expect((await t.post(undefined, ok)).status).toBe(401);
    expect((await t.post("bruno", ok)).status).toBe(403);
    const ticket = (await (await t.post("ana", ok)).json()) as { assetId: string };
    expect((await t.complete("bruno", ticket.assetId)).status).toBe(403);
    expect((await t.getUrl("bruno", `media:${ticket.assetId}`)).status).toBe(403);
    expect((await t.getUrl(undefined, `media:${ticket.assetId}`)).status).toBe(401);
  });

  it("GLB inválido → 422 y se borran objeto y asset", async () => {
    const t = setup();
    const bad = glb({ cameras: [{ type: "perspective" }] });
    const ticket = (await (await t.post("ana", body(bad.byteLength))).json()) as {
      assetId: string;
    };
    const key = t.store.rows.get(ticket.assetId)!.storageKey;
    t.blobs.simulatePut(key, bad, "model/gltf-binary");
    const res = await t.complete("ana", ticket.assetId);
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorJson).error.message).toMatch(/cámaras/);
    expect(t.store.rows.size).toBe(0);
    expect(t.blobs.objects.has(key)).toBe(false);
  });

  it("no es un GLB → 415", async () => {
    const t = setup();
    const junk = new TextEncoder().encode("esto no es un glb");
    const ticket = (await (await t.post("ana", body(junk.byteLength))).json()) as {
      assetId: string;
    };
    t.blobs.simulatePut(t.store.rows.get(ticket.assetId)!.storageKey, junk, "model/gltf-binary");
    expect((await t.complete("ana", ticket.assetId)).status).toBe(415);
  });

  it("demasiado grande → 413 (declarado y real)", async () => {
    const t = setup();
    expect((await t.post("ana", body(MODEL3D_LIMITS.maxBytes + 1))).status).toBe(413);
    const ticket = (await (await t.post("ana", body(10))).json()) as { assetId: string };
    t.blobs.simulatePut(
      t.store.rows.get(ticket.assetId)!.storageKey,
      new Uint8Array(MODEL3D_LIMITS.maxBytes + 1),
      "model/gltf-binary",
    );
    expect((await t.complete("ana", ticket.assetId)).status).toBe(413);
  });

  it("tipo declarado no admitido → 415; cuerpo mal formado → 422; JSON roto → 400", async () => {
    const t = setup();
    const badType = await t.post("ana", { ...body(10), contentType: "video/mp4" });
    expect(badType.status).toBe(415);
    const invalid = await t.post("ana", { filename: "", contentType: 3 });
    expect(invalid.status).toBe(422);
    expect((await t.post("ana", "{no json")).status).toBe(400);
  });

  it("url sin ref → 422", async () => {
    const t = setup();
    expect((await t.getUrl("ana", null)).status).toBe(422);
  });
});
