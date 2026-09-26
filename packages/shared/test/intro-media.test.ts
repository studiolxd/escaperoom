import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import {
  ANONYMOUS_ACTOR,
  collectAssetRefs,
  createAudioPublishAssetSource,
  createAudioAssetService,
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
  createIntroMediaUrlResolver,
  createRoomPublishService,
  IntroMediaError,
  introMediaRef,
  parseIntroMediaRef,
  parsePublishedIntroMediaRef,
  parseWebVtt,
  rewriteAssetRefs,
  RoomPublishError,
  sniffIntroVideoType,
  type Actor,
} from "../src/services";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOM_ID = "22222222-2222-4222-8222-222222222222";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };

const MP4 = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4, 5,
]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 2, 3]);
const VTT = new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:02.000\nHola\n");

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

function setup(opts: { maxVideoBytes?: number } = {}) {
  const store = createInMemoryIntroMediaStore([
    { id: ROOM_ID, authorId: author.userId },
    { id: OTHER_ROOM_ID, authorId: intruder.userId },
  ]);
  const blobs = createInMemoryIntroMediaBlobStore();
  let seq = 0;
  const service = createIntroMediaService({
    store,
    blobs,
    limits: opts.maxVideoBytes ? { maxVideoBytes: opts.maxVideoBytes } : {},
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

/** Sube un vídeo por el flujo PUT presignado completo. */
async function uploadVideo(
  ctx: ReturnType<typeof setup>,
  bytes = MP4,
  contentType = "video/mp4",
): Promise<string> {
  const ticket = await ctx.service.createVideoUpload(author, ROOM_ID, {
    filename: "intro.mp4",
    contentType,
    byteSize: bytes.byteLength,
  });
  const key = ctx.store.rows.get(ticket.assetId)!.storageKey;
  ctx.blobs.simulatePut(key, bytes, contentType);
  return (await ctx.service.completeVideoUpload(author, ROOM_ID, ticket.assetId)).ref;
}

describe("sniff y formatos", () => {
  it("reconoce mp4 (ftyp en el offset 4) y webm (EBML)", () => {
    expect(sniffIntroVideoType(MP4)).toBe("video/mp4");
    expect(sniffIntroVideoType(WEBM)).toBe("video/webm");
    expect(sniffIntroVideoType(new TextEncoder().encode("<html>hola</html>"))).toBeNull();
    expect(sniffIntroVideoType(new Uint8Array([0, 0]))).toBeNull();
  });

  it("WebVTT: UTF-8 estricto, BOM opcional y cabecera WEBVTT", () => {
    expect(parseWebVtt(VTT)).not.toBeNull();
    expect(parseWebVtt(new TextEncoder().encode("﻿WEBVTT - título\n"))).not.toBeNull();
    expect(parseWebVtt(new TextEncoder().encode("WEBVTT"))).not.toBeNull();
    expect(parseWebVtt(new TextEncoder().encode("WEBVTTX\n"))).toBeNull();
    expect(
      parseWebVtt(new TextEncoder().encode("1\n00:00:00,000 --> 00:00:01,000\nSRT\n")),
    ).toBeNull();
    expect(
      parseWebVtt(new Uint8Array([0x57, 0x45, 0x42, 0x56, 0x54, 0x54, 0x0a, 0xff])),
    ).toBeNull();
  });

  it("referencias: media:<uuid> y claves publicadas con la forma exacta", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(parseIntroMediaRef(introMediaRef(id))).toBe(id);
    expect(parseIntroMediaRef("media:nope")).toBeNull();
    expect(parseIntroMediaRef("upload:" + id)).toBeNull();
    const key = `assets/rooms/${ROOM_ID}/${"a".repeat(64)}.mp4`;
    expect(parsePublishedIntroMediaRef(`r2://${key}`)).toBe(key);
    expect(parsePublishedIntroMediaRef("r2://uploads/intro/x/y.mp4")).toBeNull();
    expect(parsePublishedIntroMediaRef(`r2://assets/rooms/${ROOM_ID}/../../x.mp4`)).toBeNull();
    expect(parsePublishedIntroMediaRef(key)).toBeNull();
  });
});

describe("vídeo por PUT presignado", () => {
  it("reserva pending, firma el PUT y al completar queda ready con ref media:", async () => {
    const ctx = setup();
    const ticket = await ctx.service.createVideoUpload(author, ROOM_ID, {
      filename: "intro.mp4",
      contentType: "video/mp4",
      byteSize: MP4.byteLength,
    });
    const row = ctx.store.rows.get(ticket.assetId)!;
    expect(row).toMatchObject({ status: "pending", kind: "video", roomId: ROOM_ID, lang: null });
    expect(row.storageKey).toBe(`uploads/intro/${ROOM_ID}/${ticket.assetId}.mp4`);
    expect(ticket.headers).toEqual({ "Content-Type": "video/mp4" });
    expect(ticket.uploadUrl).toContain(row.storageKey);

    // Completar antes de subir: el objeto aún no está.
    expect(await codeOf(ctx.service.completeVideoUpload(author, ROOM_ID, ticket.assetId))).toBe(
      "UPLOAD_INCOMPLETE",
    );
    ctx.blobs.simulatePut(row.storageKey, MP4, "video/mp4");
    const { ref } = await ctx.service.completeVideoUpload(author, ROOM_ID, ticket.assetId);
    expect(ref).toBe(introMediaRef(ticket.assetId));
    expect(ctx.store.rows.get(ticket.assetId)).toMatchObject({
      status: "ready",
      byteSize: MP4.byteLength,
    });
    // Idempotente.
    await expect(ctx.service.completeVideoUpload(author, ROOM_ID, ticket.assetId)).resolves.toEqual(
      { ref },
    );
  });

  it("webm también; application/octet-stream se decide por la extensión", async () => {
    const ctx = setup();
    const ticket = await ctx.service.createVideoUpload(author, ROOM_ID, {
      filename: "intro.webm",
      contentType: "application/octet-stream",
      byteSize: WEBM.byteLength,
    });
    const row = ctx.store.rows.get(ticket.assetId)!;
    expect(row.contentType).toBe("video/webm");
    expect(row.storageKey.endsWith(".webm")).toBe(true);
    ctx.blobs.simulatePut(row.storageKey, WEBM, "video/webm");
    await expect(
      ctx.service.completeVideoUpload(author, ROOM_ID, ticket.assetId),
    ).resolves.toMatchObject({ ref: introMediaRef(ticket.assetId) });
  });

  it("rechaza tipo declarado no admitido y tamaño declarado fuera de límite", async () => {
    const ctx = setup({ maxVideoBytes: 100 });
    const create = (contentType: string, byteSize: number, filename = "intro.mp4") =>
      ctx.service.createVideoUpload(author, ROOM_ID, { filename, contentType, byteSize });
    expect(await codeOf(create("video/quicktime", 10, "intro.mov"))).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(await codeOf(create("image/png", 10))).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(await codeOf(create("video/mp4", 101))).toBe("PAYLOAD_TOO_LARGE");
    expect(await codeOf(create("video/mp4", 0))).toBe("VALIDATION_ERROR");
    expect(await codeOf(create("video/mp4", 1.5))).toBe("VALIDATION_ERROR");
    expect(ctx.store.rows.size).toBe(0);
  });

  it("magic bytes que no cuadran: borra el objeto y el asset", async () => {
    const ctx = setup();
    const ticket = await ctx.service.createVideoUpload(author, ROOM_ID, {
      filename: "intro.mp4",
      contentType: "video/mp4",
      byteSize: 20,
    });
    const key = ctx.store.rows.get(ticket.assetId)!.storageKey;
    ctx.blobs.simulatePut(key, new TextEncoder().encode("<html>no soy vídeo</html>"), "video/mp4");
    expect(await codeOf(ctx.service.completeVideoUpload(author, ROOM_ID, ticket.assetId))).toBe(
      "UNSUPPORTED_MEDIA_TYPE",
    );
    expect(ctx.blobs.objects.has(key)).toBe(false);
    expect(ctx.store.rows.has(ticket.assetId)).toBe(false);
  });

  it("un webm declarado como mp4 tampoco pasa (el tipo debe coincidir)", async () => {
    const ctx = setup();
    expect(await codeOf(uploadVideo(ctx, WEBM, "video/mp4"))).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("objeto real mayor que el límite (el PUT no admite condiciones): se borra", async () => {
    const ctx = setup({ maxVideoBytes: 12 });
    const ticket = await ctx.service.createVideoUpload(author, ROOM_ID, {
      filename: "intro.mp4",
      contentType: "video/mp4",
      byteSize: 12,
    });
    const key = ctx.store.rows.get(ticket.assetId)!.storageKey;
    ctx.blobs.simulatePut(key, MP4, "video/mp4");
    expect(await codeOf(ctx.service.completeVideoUpload(author, ROOM_ID, ticket.assetId))).toBe(
      "PAYLOAD_TOO_LARGE",
    );
    expect(ctx.blobs.objects.has(key)).toBe(false);
  });

  it("permisos: anónimo, no autor, sala inexistente, asset de otra sala", async () => {
    const ctx = setup();
    const input = { filename: "a.mp4", contentType: "video/mp4", byteSize: 10 };
    expect(await codeOf(ctx.service.createVideoUpload(ANONYMOUS_ACTOR, ROOM_ID, input))).toBe(
      "UNAUTHORIZED",
    );
    expect(await codeOf(ctx.service.createVideoUpload(intruder, ROOM_ID, input))).toBe("FORBIDDEN");
    expect(await codeOf(ctx.service.createVideoUpload(author, "no-uuid", input))).toBe("NOT_FOUND");
    expect(
      await codeOf(
        ctx.service.createVideoUpload(author, "99999999-9999-4999-8999-999999999999", input),
      ),
    ).toBe("NOT_FOUND");

    const ticket = await ctx.service.createVideoUpload(author, ROOM_ID, input);
    expect(await codeOf(ctx.service.completeVideoUpload(intruder, ROOM_ID, ticket.assetId))).toBe(
      "FORBIDDEN",
    );
    expect(
      await codeOf(ctx.service.completeVideoUpload(intruder, OTHER_ROOM_ID, ticket.assetId)),
    ).toBe("NOT_FOUND");
    expect(await codeOf(ctx.service.completeVideoUpload(author, ROOM_ID, "no-uuid"))).toBe(
      "NOT_FOUND",
    );
  });
});

describe("vídeo en el cuerpo (MCP) y subtítulos", () => {
  it("uploadVideoBytes: sniff y límite, nace ready", async () => {
    const ctx = setup({ maxVideoBytes: 1000 });
    const { ref } = await ctx.service.uploadVideoBytes(author, ROOM_ID, {
      filename: "intro.webm",
      contentType: "video/webm",
      bytes: WEBM,
    });
    const row = ctx.store.rows.get(parseIntroMediaRef(ref)!)!;
    expect(row).toMatchObject({ status: "ready", contentType: "video/webm" });
    expect(ctx.blobs.objects.get(row.storageKey)?.bytes).toEqual(WEBM);

    const bad = (bytes: Uint8Array, contentType = "video/mp4") =>
      ctx.service.uploadVideoBytes(author, ROOM_ID, { filename: "x.mp4", contentType, bytes });
    expect(await codeOf(bad(new TextEncoder().encode("hola hola hola")))).toBe(
      "UNSUPPORTED_MEDIA_TYPE",
    );
    expect(await codeOf(bad(new Uint8Array(1001)))).toBe("PAYLOAD_TOO_LARGE");
    expect(await codeOf(bad(MP4, "text/plain"))).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(await codeOf(bad(new Uint8Array(0)))).toBe("VALIDATION_ERROR");
  });

  it("uploadSubtitles: WebVTT por idioma, text/vtt", async () => {
    const ctx = setup();
    const { ref } = await ctx.service.uploadSubtitles(author, ROOM_ID, { lang: "es", bytes: VTT });
    const row = ctx.store.rows.get(parseIntroMediaRef(ref)!)!;
    expect(row).toMatchObject({
      kind: "subtitles",
      lang: "es",
      status: "ready",
      contentType: "text/vtt",
    });
    expect(row.storageKey).toMatch(new RegExp(`^uploads/intro/${ROOM_ID}/.+\\.vtt$`));

    const up = (lang: string, bytes: Uint8Array) =>
      ctx.service.uploadSubtitles(author, ROOM_ID, { lang, bytes });
    expect(await codeOf(up("español!", VTT))).toBe("VALIDATION_ERROR");
    expect(await codeOf(up("es", new TextEncoder().encode("no es vtt")))).toBe(
      "UNSUPPORTED_MEDIA_TYPE",
    );
    expect(await codeOf(up("es", new Uint8Array(512 * 1024 + 1)))).toBe("PAYLOAD_TOO_LARGE");
    expect(await codeOf(up("es", new Uint8Array(0)))).toBe("VALIDATION_ERROR");
    expect(
      await codeOf(ctx.service.uploadSubtitles(intruder, ROOM_ID, { lang: "es", bytes: VTT })),
    ).toBe("FORBIDDEN");
  });
});

describe("resolución de referencias y URLs firmadas", () => {
  it("borrador: solo los media: propios y ready; claves publicadas para cualquiera", async () => {
    const ctx = setup();
    const ref = await uploadVideo(ctx);
    const key = ctx.store.rows.get(parseIntroMediaRef(ref)!)!.storageKey;
    await expect(ctx.service.resolveMediaRef(author, ref)).resolves.toBe(key);
    expect(await codeOf(ctx.service.resolveMediaRef(intruder, ref))).toBe("FORBIDDEN");
    expect(await codeOf(ctx.service.resolveMediaRef(null, ref))).toBe("FORBIDDEN");
    expect(await codeOf(ctx.service.resolveMediaRef(ANONYMOUS_ACTOR, ref))).toBe("UNAUTHORIZED");
    // Playtest de la sala: el medio es del autor de esa sala.
    await expect(ctx.service.resolveMediaRef({ roomId: ROOM_ID }, ref)).resolves.toBe(key);
    expect(await codeOf(ctx.service.resolveMediaRef({ roomId: OTHER_ROOM_ID }, ref))).toBe(
      "FORBIDDEN",
    );

    const published = `r2://assets/rooms/${ROOM_ID}/${"b".repeat(64)}.webm`;
    await expect(ctx.service.resolveMediaRef(null, published)).resolves.toBe(
      published.slice("r2://".length),
    );
    expect(await codeOf(ctx.service.resolveMediaRef(author, "r2://uploads/audio/x.mp3"))).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await codeOf(
        ctx.service.resolveMediaRef(author, introMediaRef("cccccccc-cccc-4ccc-8ccc-cccccccccccc")),
      ),
    ).toBe("NOT_FOUND");
  });

  it("un vídeo pending no se resuelve (NOT_READY)", async () => {
    const ctx = setup();
    const ticket = await ctx.service.createVideoUpload(author, ROOM_ID, {
      filename: "intro.mp4",
      contentType: "video/mp4",
      byteSize: 10,
    });
    expect(await codeOf(ctx.service.resolveMediaRef(author, introMediaRef(ticket.assetId)))).toBe(
      "NOT_READY",
    );
  });

  it("previewUrl (solo el autor) y el resolver para resolveIntroModel (nunca lanza)", async () => {
    const ctx = setup();
    const ref = await uploadVideo(ctx);
    await expect(ctx.service.previewUrl(author, ROOM_ID, ref)).resolves.toMatch(/^memory:\/\//);
    expect(await codeOf(ctx.service.previewUrl(intruder, ROOM_ID, ref))).toBe("FORBIDDEN");

    const playtest = createIntroMediaUrlResolver(
      ctx.service,
      { roomId: ROOM_ID },
      {
        expiresIn: 21600,
      },
    );
    await expect(playtest(ref)).resolves.toMatch(/expiresIn=21600$/);
    const published = createIntroMediaUrlResolver(ctx.service, null);
    await expect(published(ref)).resolves.toBeNull();
    await expect(published("basura")).resolves.toBeNull();
  });
});

describe("publicación de la introducción", () => {
  function withIntro(pkg: RoomPackage, video: string, subtitles?: Record<string, string>) {
    pkg.meta.intro = { type: "video", video, ...(subtitles ? { subtitles } : {}) };
    return pkg;
  }

  function setupPublish(opts: { streaming: boolean }) {
    const ctx = setup();
    const audioBlobs = createInMemoryAudioBlobStore();
    const audio = createAudioAssetService({
      store: createInMemoryAudioAssetStore(),
      blobs: audioBlobs,
    });
    const storage = createInMemoryPublishedAssetStorage();
    const copies: string[] = [];
    const publishedStorage = opts.streaming
      ? {
          ...storage,
          put: storage.put,
          async digest(key: string) {
            const o = ctx.blobs.objects.get(key)!;
            return {
              sha256: createHash("sha256").update(o.bytes).digest("hex"),
              byteSize: o.bytes.byteLength,
            };
          },
          async copy(from: string, to: string, contentType: string) {
            copies.push(from);
            storage.objects.set(to, { bytes: ctx.blobs.objects.get(from)!.bytes, contentType });
          },
        }
      : storage;
    let draft = structuredClone(reyAldric);
    const publish = createRoomPublishService({
      store: createInMemoryRoomPublishStore([
        { id: ROOM_ID, authorId: author.userId, status: "draft" },
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
    return {
      ...ctx,
      publish,
      storage,
      copies,
      setDraft(pkg: RoomPackage) {
        draft = pkg;
      },
    };
  }

  it("collect/rewrite incluyen vídeo y subtítulos de meta.intro", () => {
    const pkg = withIntro(structuredClone(reyAldric), "media:v", { es: "media:s" });
    expect(collectAssetRefs(pkg)).toEqual(expect.arrayContaining(["media:s", "media:v"]));
    const out = rewriteAssetRefs(
      pkg,
      new Map([
        ["media:v", "r2://V"],
        ["media:s", "r2://S"],
      ]),
    );
    expect(out.meta.intro).toEqual({ type: "video", video: "r2://V", subtitles: { es: "r2://S" } });
    expect(pkg.meta.intro).toEqual({
      type: "video",
      video: "media:v",
      subtitles: { es: "media:s" },
    });
    // Una intro de texto o claves ya publicadas no se tocan.
    const published = withIntro(structuredClone(reyAldric), `r2://assets/rooms/${ROOM_ID}/x.mp4`);
    expect(collectAssetRefs(published).some((r) => r.startsWith("r2://"))).toBe(false);
  });

  for (const streaming of [true, false]) {
    it(`empaqueta vídeo y subtítulos con clave por contenido (${streaming ? "digest + copia" : "en memoria"})`, async () => {
      const ctx = setupPublish({ streaming });
      const video = await uploadVideo(ctx);
      const { ref: subs } = await ctx.service.uploadSubtitles(author, ROOM_ID, {
        lang: "es",
        bytes: VTT,
      });
      ctx.setDraft(withIntro(structuredClone(reyAldric), video, { es: subs }));

      const result = await ctx.publish.publish(author, ROOM_ID);
      const videoAsset = result.assets.find((a) => a.ref === video)!;
      const subsAsset = result.assets.find((a) => a.ref === subs)!;
      const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
      expect(videoAsset.key).toBe(`assets/rooms/${ROOM_ID}/${sha(MP4)}.mp4`);
      expect(subsAsset.key).toBe(`assets/rooms/${ROOM_ID}/${sha(VTT)}.vtt`);
      expect(ctx.storage.objects.get(videoAsset.key)).toMatchObject({ contentType: "video/mp4" });
      expect(ctx.storage.objects.get(subsAsset.key)?.bytes).toEqual(VTT);
      expect(ctx.copies.length).toBe(streaming ? 2 : 0);

      const { package: frozen } = await ctx.publish.getVersionPackage(
        author,
        ROOM_ID,
        result.version.id,
      );
      expect(frozen.meta.intro).toEqual({
        type: "video",
        video: `r2://${videoAsset.key}`,
        subtitles: { es: `r2://${subsAsset.key}` },
      });
      // Y lo publicado se resuelve sin actor.
      await expect(
        ctx.service.resolveMediaRef(null, (frozen.meta.intro as { video: string }).video),
      ).resolves.toBe(videoAsset.key);
    });
  }

  it("bloquea si el vídeo no existe, es de otro o su subida no se completó", async () => {
    const ctx = setupPublish({ streaming: true });
    const ticket = await ctx.service.createVideoUpload(author, ROOM_ID, {
      filename: "intro.mp4",
      contentType: "video/mp4",
      byteSize: 10,
    });
    const missing = introMediaRef("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    ctx.setDraft(
      withIntro(structuredClone(reyAldric), introMediaRef(ticket.assetId), { es: missing }),
    );
    const err = await ctx.publish.publish(author, ROOM_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RoomPublishError);
    expect((err as RoomPublishError).code).toBe("ASSETS_NOT_PUBLISHABLE");
    expect((err as RoomPublishError).details.problems?.map((p) => [p.ref, p.code]).sort()).toEqual(
      [
        [introMediaRef(ticket.assetId), "NOT_READY"],
        [missing, "NOT_FOUND"],
      ].sort(),
    );
    expect(ctx.storage.objects.size).toBe(0);
  });
});
