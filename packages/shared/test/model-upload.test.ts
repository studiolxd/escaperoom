import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import {
  collectAssetRefs,
  createRoomPublishService,
  createAudioAssetService,
  createAudioPublishAssetSource,
  createCompositePublishAssetSource,
  createInMemoryAudioAssetStore,
  createInMemoryAudioBlobStore,
  createInMemoryIntroMediaBlobStore,
  createInMemoryIntroMediaStore,
  createInMemoryPublishedAssetStorage,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPublishStore,
  createIntroMediaPublishAssetSource,
  createIntroMediaService,
  IntroMediaError,
  introMediaRef,
  parsePublishedIntroMediaRef,
  publishedAssetKey,
  rewriteAssetRefs,
  RoomPublishError,
  type Actor,
} from "../src/services";
import { MODEL3D_LIMITS } from "../src/models3d";
import { makeRoom3D } from "./fixtures/room-3d";
import { buildGlb, cube } from "./fixtures/glb";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };

const GLB = buildGlb(cube({ animations: [{ name: "abrir" }] }));

function setup() {
  const store = createInMemoryIntroMediaStore([{ id: ROOM_ID, authorId: author.userId }]);
  const blobs = createInMemoryIntroMediaBlobStore();
  let seq = 0;
  const service = createIntroMediaService({
    store,
    blobs,
    newId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, "0")}`,
  });
  return { store, blobs, service };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(IntroMediaError);
  return (err as IntroMediaError).code;
}

async function uploadModel(ctx: ReturnType<typeof setup>, bytes = GLB) {
  const ticket = await ctx.service.createModelUpload(author, ROOM_ID, {
    filename: "arca.glb",
    contentType: "model/gltf-binary",
    byteSize: bytes.byteLength,
  });
  ctx.blobs.simulatePut(ctx.store.rows.get(ticket.assetId)!.storageKey, bytes, "model/gltf-binary");
  return { ticket, done: await ctx.service.completeModelUpload(author, ROOM_ID, ticket.assetId) };
}

describe("subida de modelos GLB", () => {
  it("ciclo completo: reserva, PUT, complete (valida y mide)", async () => {
    const ctx = setup();
    const { ticket, done } = await uploadModel(ctx);
    expect(ticket.uploadUrl).toContain(`uploads/models/${ROOM_ID}/`);
    expect(ticket.headers).toEqual({ "Content-Type": "model/gltf-binary" });
    expect(done).toMatchObject({
      ref: introMediaRef(ticket.assetId),
      triangles: 12,
      clips: ["abrir"],
      byteSize: GLB.byteLength,
      size: { w: 2, d: 4, hgt: 3 },
      colliders: [{ type: "box", sx: 2, sy: 4, sh: 3 }],
    });
    const row = ctx.store.rows.get(ticket.assetId)!;
    expect(row).toMatchObject({ kind: "model", status: "ready", contentType: "model/gltf-binary" });
    expect(row.storageKey).toMatch(new RegExp(`^uploads/models/${ROOM_ID}/.+\\.glb$`));
  });

  it("complete es idempotente sobre un asset ya ready", async () => {
    const ctx = setup();
    const { ticket, done } = await uploadModel(ctx);
    await expect(ctx.service.completeModelUpload(author, ROOM_ID, ticket.assetId)).resolves.toEqual(
      done,
    );
  });

  it("acepta octet-stream o vacío con extensión .glb; rechaza otros tipos", async () => {
    const ctx = setup();
    for (const contentType of ["application/octet-stream", ""]) {
      await expect(
        ctx.service.createModelUpload(author, ROOM_ID, { filename: "a.GLB", contentType, byteSize: 10 }),
      ).resolves.toBeTruthy();
    }
    expect(
      await codeOf(
        ctx.service.createModelUpload(author, ROOM_ID, {
          filename: "a.gltf",
          contentType: "application/octet-stream",
          byteSize: 10,
        }),
      ),
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(
      await codeOf(
        ctx.service.createModelUpload(author, ROOM_ID, {
          filename: "a.glb",
          contentType: "video/mp4",
          byteSize: 10,
        }),
      ),
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("tamaño declarado: vacío → VALIDATION_ERROR, excesivo → PAYLOAD_TOO_LARGE", async () => {
    const ctx = setup();
    const base = { filename: "a.glb", contentType: "model/gltf-binary" };
    expect(await codeOf(ctx.service.createModelUpload(author, ROOM_ID, { ...base, byteSize: 0 }))).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await codeOf(
        ctx.service.createModelUpload(author, ROOM_ID, {
          ...base,
          byteSize: MODEL3D_LIMITS.maxBytes + 1,
        }),
      ),
    ).toBe("PAYLOAD_TOO_LARGE");
  });

  it("un GLB inválido borra objeto y asset", async () => {
    const ctx = setup();
    const bad = buildGlb(cube({ cameras: [{ type: "perspective" }] }));
    const ticket = await ctx.service.createModelUpload(author, ROOM_ID, {
      filename: "a.glb",
      contentType: "model/gltf-binary",
      byteSize: bad.byteLength,
    });
    const key = ctx.store.rows.get(ticket.assetId)!.storageKey;
    ctx.blobs.simulatePut(key, bad, "model/gltf-binary");
    expect(await codeOf(ctx.service.completeModelUpload(author, ROOM_ID, ticket.assetId))).toBe(
      "VALIDATION_ERROR",
    );
    expect(ctx.store.rows.has(ticket.assetId)).toBe(false);
    expect(ctx.blobs.objects.has(key)).toBe(false);
  });

  it("no es un GLB → UNSUPPORTED_MEDIA_TYPE; demasiado grande en el bucket → PAYLOAD_TOO_LARGE", async () => {
    const ctx = setup();
    const junk = new TextEncoder().encode("no soy un glb");
    const t1 = await ctx.service.createModelUpload(author, ROOM_ID, {
      filename: "a.glb",
      contentType: "model/gltf-binary",
      byteSize: junk.byteLength,
    });
    ctx.blobs.simulatePut(ctx.store.rows.get(t1.assetId)!.storageKey, junk, "model/gltf-binary");
    expect(await codeOf(ctx.service.completeModelUpload(author, ROOM_ID, t1.assetId))).toBe(
      "UNSUPPORTED_MEDIA_TYPE",
    );
    const t2 = await ctx.service.createModelUpload(author, ROOM_ID, {
      filename: "a.glb",
      contentType: "model/gltf-binary",
      byteSize: 10,
    });
    ctx.blobs.simulatePut(
      ctx.store.rows.get(t2.assetId)!.storageKey,
      new Uint8Array(MODEL3D_LIMITS.maxBytes + 1),
      "model/gltf-binary",
    );
    expect(await codeOf(ctx.service.completeModelUpload(author, ROOM_ID, t2.assetId))).toBe(
      "PAYLOAD_TOO_LARGE",
    );
    expect(ctx.store.rows.size).toBe(0);
  });

  it("complete antes del PUT → UPLOAD_INCOMPLETE; con un asset de otro tipo → NOT_FOUND", async () => {
    const ctx = setup();
    const ticket = await ctx.service.createModelUpload(author, ROOM_ID, {
      filename: "a.glb",
      contentType: "model/gltf-binary",
      byteSize: 10,
    });
    expect(await codeOf(ctx.service.completeModelUpload(author, ROOM_ID, ticket.assetId))).toBe(
      "UPLOAD_INCOMPLETE",
    );
    const video = await ctx.service.createVideoUpload(author, ROOM_ID, {
      filename: "a.mp4",
      contentType: "video/mp4",
      byteSize: 10,
    });
    expect(await codeOf(ctx.service.completeModelUpload(author, ROOM_ID, video.assetId))).toBe(
      "NOT_FOUND",
    );
  });

  it("no autor → FORBIDDEN; ajeno → NOT_FOUND al completar", async () => {
    const ctx = setup();
    const input = { filename: "a.glb", contentType: "model/gltf-binary", byteSize: 10 };
    expect(await codeOf(ctx.service.createModelUpload(intruder, ROOM_ID, input))).toBe("FORBIDDEN");
    expect(
      await codeOf(
        ctx.service.uploadModelBytes(intruder, ROOM_ID, { ...input, bytes: GLB }),
      ),
    ).toBe("FORBIDDEN");
    const { ticket } = await uploadModel(ctx);
    expect(await codeOf(ctx.service.completeModelUpload(intruder, ROOM_ID, ticket.assetId))).toBe(
      "FORBIDDEN",
    );
  });

  it("uploadModelBytes: nace ready y valida los bytes", async () => {
    const ctx = setup();
    const res = await ctx.service.uploadModelBytes(author, ROOM_ID, {
      filename: "arca.glb",
      contentType: "",
      bytes: GLB,
    });
    const id = res.ref.slice("media:".length);
    expect(ctx.store.rows.get(id)).toMatchObject({ kind: "model", status: "ready" });
    expect(res.triangles).toBe(12);
    expect(
      await codeOf(
        ctx.service.uploadModelBytes(author, ROOM_ID, {
          filename: "x.glb",
          contentType: "model/gltf-binary",
          bytes: new Uint8Array([1, 2, 3, 4]),
        }),
      ),
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(ctx.store.rows.size).toBe(1);
  });

  it("describeModel vuelve a medir; rechaza lo que no es un GLB", async () => {
    const ctx = setup();
    const { done } = await uploadModel(ctx);
    await expect(ctx.service.describeModel(author, done.ref)).resolves.toEqual(done);
    await expect(ctx.service.describeModel({ roomId: ROOM_ID }, done.ref)).resolves.toEqual(done);
    expect(await codeOf(ctx.service.describeModel(intruder, done.ref))).toBe("FORBIDDEN");
    const video = await ctx.service.uploadVideoBytes(author, ROOM_ID, {
      filename: "a.mp4",
      contentType: "video/mp4",
      bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4, 5, 6, 7, 8]),
    });
    expect(await codeOf(ctx.service.describeModel(author, video.ref))).toBe("VALIDATION_ERROR");
  });

  it("resolveMediaRef y resolveDraftAsset sirven para un modelo", async () => {
    const ctx = setup();
    const { done } = await uploadModel(ctx);
    const key = await ctx.service.resolveMediaRef(author, done.ref);
    expect(key).toMatch(/\.glb$/);
    await expect(ctx.service.resolveMediaRef({ roomId: ROOM_ID }, done.ref)).resolves.toBe(key);
    await expect(ctx.service.resolveDraftAsset(author, done.ref)).resolves.toMatchObject({
      kind: "model",
      storageKey: key,
    });
    await expect(ctx.service.previewUrl(author, ROOM_ID, done.ref)).resolves.toContain(key);
    // Un modelo sin completar no se resuelve.
    const pending = await ctx.service.createModelUpload(author, ROOM_ID, {
      filename: "a.glb",
      contentType: "model/gltf-binary",
      byteSize: 10,
    });
    expect(await codeOf(ctx.service.resolveMediaRef(author, introMediaRef(pending.assetId)))).toBe(
      "NOT_READY",
    );
  });

  it("la clave publicada .glb se acepta como ref publicada", () => {
    const key = `assets/rooms/${ROOM_ID}/${"a".repeat(64)}.glb`;
    expect(parsePublishedIntroMediaRef(`r2://${key}`)).toBe(key);
    expect(publishedAssetKey(ROOM_ID, "a".repeat(64), "model/gltf-binary")).toBe(key);
  });
});

describe("publicación con modelos propios", () => {
  function withModels(refs: Record<string, string>): RoomPackage {
    const pkg = structuredClone(makeRoom3D());
    for (const [id, ref] of Object.entries(refs)) pkg.world3d!.models[id]!.ref = ref;
    return parseRoomPackage(pkg);
  }

  function setupPublish() {
    const ctx = setup();
    const audioBlobs = createInMemoryAudioBlobStore();
    const audio = createAudioAssetService({
      store: createInMemoryAudioAssetStore(),
      blobs: audioBlobs,
    });
    const storage = createInMemoryPublishedAssetStorage();
    const publishedStorage = {
      ...storage,
      async digest(key: string) {
        const o = ctx.blobs.objects.get(key)!;
        return {
          sha256: createHash("sha256").update(o.bytes).digest("hex"),
          byteSize: o.bytes.byteLength,
        };
      },
      async copy(from: string, to: string, contentType: string) {
        storage.objects.set(to, { bytes: ctx.blobs.objects.get(from)!.bytes, contentType });
      },
    };
    let draft = makeRoom3D();
    const publish = (() => {
      return createRoomPublishService({
        store: createInMemoryRoomPublishStore([
          { id: ROOM_ID, authorId: author.userId, status: "draft", dimension: "3d" },
        ]),
        drafts: createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]),
        serializer: () => structuredClone(draft),
        assets: createCompositePublishAssetSource({
          audio: createAudioPublishAssetSource({
            audio,
            readObject: async (key) => audioBlobs.objects.get(key)!,
          }),
          introMedia: createIntroMediaPublishAssetSource({
            introMedia: ctx.service,
            readObject: async (key) => ctx.blobs.objects.get(key)!,
          }),
        }),
        storage: publishedStorage,
      });
    })();
    return {
      ...ctx,
      publish,
      storage,
      setDraft(pkg: RoomPackage) {
        draft = pkg;
      },
    };
  }

  it("collect/rewrite incluyen los ref de world3d.models", () => {
    const pkg = withModels({ "suelo-test": "media:m1", "arca-test": "media:m2" });
    expect(collectAssetRefs(pkg)).toEqual(["media:m1", "media:m2"]);
    const out = rewriteAssetRefs(pkg, new Map([["media:m1", "r2://M1"]]));
    expect(out.world3d!.models["suelo-test"]!.ref).toBe("r2://M1");
    expect(out.world3d!.models["arca-test"]!.ref).toBe("media:m2");
    expect(pkg.world3d!.models["suelo-test"]!.ref).toBe("media:m1");
    // Un ref ya publicado o `upload:` no entra en los medios.
    expect(collectAssetRefs(makeRoom3D())).toEqual(
      expect.not.arrayContaining(["media:m1"]),
    );
  });

  it("copia el GLB a assets/rooms/<roomId>/<sha256>.glb y reescribe el ref", async () => {
    const ctx = setupPublish();
    const { done } = await uploadModel(ctx);
    ctx.setDraft(withModels({ "suelo-test": done.ref, "arca-test": done.ref }));
    const result = await ctx.publish.publish(author, ROOM_ID);
    const sha = createHash("sha256").update(GLB).digest("hex");
    const key = `assets/rooms/${ROOM_ID}/${sha}.glb`;
    expect(result.assets.find((a) => a.ref === done.ref)).toMatchObject({
      key,
      contentType: "model/gltf-binary",
    });
    expect(ctx.storage.objects.get(key)?.contentType).toBe("model/gltf-binary");
    const { package: frozen } = await ctx.publish.getVersionPackage(author, ROOM_ID, result.version.id);
    expect(frozen.world3d!.models["suelo-test"]!.ref).toBe(`r2://${key}`);
    expect(frozen.world3d!.models["arca-test"]!.ref).toBe(`r2://${key}`);
  });

  it("rechaza un modelo sin completar, como un vídeo sin completar", async () => {
    const ctx = setupPublish();
    const ticket = await ctx.service.createModelUpload(author, ROOM_ID, {
      filename: "a.glb",
      contentType: "model/gltf-binary",
      byteSize: 10,
    });
    const { done } = await uploadModel(ctx);
    ctx.setDraft(withModels({ "suelo-test": introMediaRef(ticket.assetId), "arca-test": done.ref }));
    const err = await ctx.publish.publish(author, ROOM_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RoomPublishError);
    expect((err as RoomPublishError).code).toBe("ASSETS_NOT_PUBLISHABLE");
    expect((err as RoomPublishError).details.problems?.map((p) => [p.ref, p.code])).toEqual([
      [introMediaRef(ticket.assetId), "NOT_READY"],
    ]);
    expect(ctx.storage.objects.size).toBe(0);
  });
});
