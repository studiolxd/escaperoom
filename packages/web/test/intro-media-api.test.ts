import {
  ANONYMOUS_ACTOR,
  createInMemoryIntroMediaBlobStore,
  createInMemoryIntroMediaStore,
  createIntroMediaService,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it, vi } from "vitest";

// `introMediaUrlResolver` importa `./services` (Prisma, bucket…) solo para su
// valor por defecto; en el test se le pasa el servicio en memoria.
vi.mock("@/server/services", () => ({ getIntroMediaService: () => null }));

import { resolveIntroModel } from "@/lib/intro-model";
import { INTRO_MEDIA_URL_TTL_SECONDS, introMediaUrlResolver } from "@/server/intro-media-url";
import { RATE_LIMIT_POLICIES } from "@/server/rate-limit";
import { createIntroMediaHandlers } from "@/server/rest/intro-media";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ana: Actor = { userId: "ana", organizationId: null, role: "member" };
const bruno: Actor = { userId: "bruno", organizationId: null, role: "member" };
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2]);
const VTT = "WEBVTT\n\n00:00.000 --> 00:02.000\nHola\n";

type ErrorJson = { error: { code: string; message: string } };

function setup() {
  const store = createInMemoryIntroMediaStore([{ id: ROOM_ID, authorId: ana.userId }]);
  const blobs = createInMemoryIntroMediaBlobStore();
  const introMedia = createIntroMediaService({ store, blobs });
  const actors: Record<string, Actor> = { ana, bruno };
  const handlers = createIntroMediaHandlers({
    introMedia,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
  });
  const base = `http://localhost/api/rooms/${ROOM_ID}/intro-media`;
  const ctx = { params: Promise.resolve({ roomId: ROOM_ID }) };
  const assetCtx = (assetId: string) => ({ params: Promise.resolve({ roomId: ROOM_ID, assetId }) });
  const headers = (user?: string, extra: Record<string, string> = {}) => ({
    ...(user ? { "x-test-user": user } : {}),
    ...extra,
  });

  return {
    store,
    blobs,
    introMedia,
    handlers,
    ctx,
    assetCtx,
    postVideo: (user: string | undefined, body: unknown) =>
      handlers.postVideo(
        new Request(`${base}/video`, {
          method: "POST",
          headers: headers(user, { "content-type": "application/json" }),
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
        ctx,
      ),
    complete: (user: string | undefined, assetId: string) =>
      handlers.postVideoComplete(
        new Request(`${base}/video/${assetId}/complete`, {
          method: "POST",
          headers: headers(user),
        }),
        assetCtx(assetId),
      ),
    postSubtitles: (user: string | undefined, lang: string | null, body: string | Uint8Array) =>
      handlers.postSubtitles(
        new Request(`${base}/subtitles${lang === null ? "" : `?lang=${lang}`}`, {
          method: "POST",
          headers: headers(user, { "content-type": "text/vtt" }),
          body: body as BodyInit,
        }),
        ctx,
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

describe("REST /api/rooms/:roomId/intro-media", () => {
  it("vídeo: 201 {assetId, uploadUrl, headers} → PUT → complete 200 {ref}", async () => {
    const t = setup();
    const res = await t.postVideo("ana", {
      filename: "intro.mp4",
      contentType: "video/mp4",
      byteSize: MP4.byteLength,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const ticket = (await res.json()) as {
      assetId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    };
    expect(Object.keys(ticket).sort()).toEqual(["assetId", "headers", "uploadUrl"]);
    expect(ticket.headers).toEqual({ "Content-Type": "video/mp4" });

    // Completar antes del PUT: 409.
    const early = await t.complete("ana", ticket.assetId);
    expect(early.status).toBe(409);
    expect(((await early.json()) as ErrorJson).error.code).toBe("UPLOAD_INCOMPLETE");

    t.blobs.simulatePut(t.store.rows.get(ticket.assetId)!.storageKey, MP4, "video/mp4");
    const done = await t.complete("ana", ticket.assetId);
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ref: `media:${ticket.assetId}` });
  });

  it("vídeo: errores con el contrato REST (401, 403, 415, 413, 422, INVALID_JSON)", async () => {
    const t = setup();
    const ok = { filename: "intro.mp4", contentType: "video/mp4", byteSize: 10 };
    expect((await t.postVideo(undefined, ok)).status).toBe(401);
    expect((await t.postVideo("bruno", ok)).status).toBe(403);
    expect((await t.postVideo("ana", { ...ok, contentType: "video/quicktime" })).status).toBe(415);
    expect((await t.postVideo("ana", { ...ok, byteSize: 201 * 1024 * 1024 })).status).toBe(413);
    const invalid = await t.postVideo("ana", { filename: "", byteSize: "x" });
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { error: { issues: unknown[] } }).error.issues).toHaveLength(
      3,
    );
    const broken = await t.postVideo("ana", "{");
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as ErrorJson).error.code).toBe("INVALID_JSON");
  });

  it("complete: contenido que no es vídeo → 415 y se borra", async () => {
    const t = setup();
    const res = await t.postVideo("ana", {
      filename: "a.mp4",
      contentType: "video/mp4",
      byteSize: 9,
    });
    const { assetId } = (await res.json()) as { assetId: string };
    const key = t.store.rows.get(assetId)!.storageKey;
    t.blobs.simulatePut(key, new TextEncoder().encode("no vídeo!"), "video/mp4");
    expect((await t.complete("ana", assetId)).status).toBe(415);
    expect(t.blobs.objects.has(key)).toBe(false);
    expect((await t.complete("ana", assetId)).status).toBe(404);
  });

  it("subtítulos: 201 {ref}; sin lang 422; no-WebVTT 415; demasiado grandes 413", async () => {
    const t = setup();
    const res = await t.postSubtitles("ana", "es", VTT);
    expect(res.status).toBe(201);
    expect((await res.json()) as { ref: string }).toMatchObject({
      ref: expect.stringMatching(/^media:/),
    });
    expect((await t.postSubtitles("ana", null, VTT)).status).toBe(422);
    expect((await t.postSubtitles("ana", "es", "1\n00:00:00,000 --> x\n")).status).toBe(415);
    expect((await t.postSubtitles("ana", "es", new Uint8Array(512 * 1024 + 1))).status).toBe(413);
    expect((await t.postSubtitles(undefined, "es", VTT)).status).toBe(401);
    expect((await t.postSubtitles("bruno", "es", VTT)).status).toBe(403);
  });

  it("url: {url} firmada solo para el autor; ref ausente 422", async () => {
    const t = setup();
    const { ref } = (await (await t.postSubtitles("ana", "es", VTT)).json()) as { ref: string };
    const res = await t.getUrl("ana", ref);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(((await res.json()) as { url: string }).url).toMatch(/^memory:\/\/uploads\/intro\//);
    expect((await t.getUrl("bruno", ref)).status).toBe(403);
    expect((await t.getUrl(undefined, ref)).status).toBe(401);
    expect((await t.getUrl("ana", null)).status).toBe(422);
  });

  it("subtítulos del mismo origen para el <track> de la vista previa (solo el autor)", async () => {
    const t = setup();
    const { ref } = (await (await t.postSubtitles("ana", "es", VTT)).json()) as { ref: string };
    const read: string[] = [];
    const handlers = createIntroMediaHandlers({
      introMedia: t.introMedia,
      resolveActor: async (req) =>
        ({ ana, bruno })[req.headers.get("x-test-user") as "ana" | "bruno"] ?? ANONYMOUS_ACTOR,
      readText: async (url) => {
        read.push(url);
        return VTT;
      },
    });
    const get = (user: string | undefined, value: string | null) =>
      handlers.getSubtitles(
        new Request(
          `http://localhost/api/rooms/${ROOM_ID}/intro-media/subtitles${value === null ? "" : `?ref=${encodeURIComponent(value)}`}`,
          { headers: user ? { "x-test-user": user } : {} },
        ),
        t.ctx,
      );
    const res = await get("ana", ref);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    expect(await res.text()).toBe(VTT);
    expect(read).toHaveLength(1);
    expect((await get("bruno", ref)).status).toBe(403);
    expect((await get(undefined, ref)).status).toBe(401);
    expect((await get("ana", null)).status).toBe(422);
  });

  it("las rutas tienen cuota propia en RATE_LIMIT_POLICIES", () => {
    expect(RATE_LIMIT_POLICIES["intro-media-upload"].user).toBeDefined();
    expect(RATE_LIMIT_POLICIES["intro-media-complete"].user).toBeDefined();
    expect(RATE_LIMIT_POLICIES["intro-media-read"].user).toBeDefined();
  });
});

describe("introMediaUrlResolver + resolveIntroModel", () => {
  async function withVideo() {
    const t = setup();
    const { ref: video } = await t.introMedia.uploadVideoBytes(ana, ROOM_ID, {
      filename: "intro.mp4",
      contentType: "video/mp4",
      bytes: MP4,
    });
    const { ref: es } = await t.introMedia.uploadSubtitles(ana, ROOM_ID, {
      lang: "es",
      bytes: new TextEncoder().encode(VTT),
    });
    return { ...t, video, es };
  }

  it("playtest del borrador: media:<uuid> del autor → URLs firmadas de 6 h", async () => {
    const t = await withVideo();
    const model = await resolveIntroModel(
      { type: "video", video: t.video, subtitles: { es: t.es, en: "media:basura" } },
      {
        locale: "es",
        defaultLanguage: "es",
        languages: ["es", "en"],
        resolveMediaUrl: introMediaUrlResolver({ kind: "draft", roomId: ROOM_ID }, t.introMedia),
        // Los subtítulos se leen por su URL firmada (en el test, sin red).
        readMediaText: async (url: string) => (url.startsWith("memory://") ? VTT : null),
      },
    );
    expect(model).toMatchObject({ kind: "video", subtitles: [{ lang: "es" }] });
    const video = model as { videoUrl: string };
    expect(video.videoUrl).toMatch(new RegExp(`expiresIn=${INTRO_MEDIA_URL_TTL_SECONDS}$`));
    expect(INTRO_MEDIA_URL_TTL_SECONDS).toBe(6 * 60 * 60);
  });

  it("versión publicada: un media: de borrador no se sirve (sin intro); las claves publicadas sí", async () => {
    const t = await withVideo();
    const published = introMediaUrlResolver({ kind: "published" }, t.introMedia);
    await expect(published(t.video)).resolves.toBeNull();
    const key = `assets/rooms/${ROOM_ID}/${"c".repeat(64)}.mp4`;
    t.blobs.simulatePut(key, MP4, "video/mp4");
    await expect(published(`r2://${key}`)).resolves.toMatch(`memory://${key}`);
    await expect(
      resolveIntroModel(
        { type: "video", video: t.video },
        { locale: "es", defaultLanguage: "es", languages: ["es"], resolveMediaUrl: published },
      ),
    ).resolves.toBeNull();
  });
});
