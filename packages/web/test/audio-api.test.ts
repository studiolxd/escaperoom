import { AUDIO_LIBRARY, createSilentMp3 } from "@escaperoom/shared/audio";
import {
  ANONYMOUS_ACTOR,
  createAudioAssetService,
  createInMemoryAudioAssetStore,
  createInMemoryAudioBlobStore,
  type Actor,
} from "@escaperoom/shared/services";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import es from "../messages/es.json";
import { AudioUploadButton } from "../src/components/editor/audio-field";
import { createAudioHandlers } from "../src/server/rest/audio";

const ana: Actor = { userId: "ana", organizationId: null, role: "member" };
const bruno: Actor = { userId: "bruno", organizationId: null, role: "member" };
const mod: Actor = { userId: "mod", organizationId: null, role: "member" };

type AssetJson = {
  id: string;
  ref: string;
  status: string;
  rejectionReason: string | null;
  previewUrl?: string | null;
};
type ErrorJson = { error: { code: string; message: string; rejectionReason?: string } };

/** Handlers REST con stores en memoria; el actor viaja en una cabecera de test. */
function setup() {
  const blobs = createInMemoryAudioBlobStore();
  const audio = createAudioAssetService({
    store: createInMemoryAudioAssetStore({ moderatorIds: [mod.userId] }),
    blobs,
  });
  const actors: Record<string, Actor> = { ana, bruno, mod };
  const handlers = createAudioHandlers({
    audio,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
  });

  function uploadRequest(
    user: string | undefined,
    file: { bytes: Uint8Array; name: string; type: string },
    rightsDeclared = true,
  ): Request {
    const form = new FormData();
    form.set("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
    if (rightsDeclared) form.set("rightsDeclared", "true");
    return new Request("http://localhost/api/audio/uploads", {
      method: "POST",
      body: form,
      headers: user ? { "x-test-user": user } : {},
    });
  }

  const mp3 = (name = "narrador.mp3") => ({
    bytes: createSilentMp3(1200),
    name,
    type: "audio/mpeg",
  });

  async function upload(user: string, file = mp3()) {
    return handlers.upload(uploadRequest(user, file));
  }

  function review(user: string, id: string, body: unknown) {
    return handlers.review(
      new Request(`http://localhost/api/admin/audio/${id}`, {
        method: "PATCH",
        headers: { "x-test-user": user, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  return { audio, blobs, handlers, uploadRequest, upload, review, mp3 };
}

describe("GET /api/audio/library", () => {
  it("lista la biblioteca con referencia, licencia y créditos; filtra por tipo", async () => {
    const { handlers } = setup();
    const all = await handlers.listLibrary(new Request("http://localhost/api/audio/library"));
    expect(all.status).toBe(200);
    const body = (await all.json()) as { items: Array<{ id: string; ref: string; kind: string }> };
    expect(body.items).toHaveLength(AUDIO_LIBRARY.length);
    expect(body.items[0]).toMatchObject({ ref: `library:${body.items[0]!.id}` });

    const music = await handlers.listLibrary(
      new Request("http://localhost/api/audio/library?kind=music"),
    );
    const musicBody = (await music.json()) as { items: Array<{ kind: string }> };
    expect(musicBody.items.every((t) => t.kind === "music")).toBe(true);

    const bad = await handlers.listLibrary(
      new Request("http://localhost/api/audio/library?kind=podcast"),
    );
    expect(bad.status).toBe(422);
  });
});

describe("POST /api/audio/uploads", () => {
  it("un MP3 propio → 201 pendiente; aparece en mis subidas", async () => {
    const { handlers, upload, blobs } = setup();
    const res = await upload("ana");
    expect(res.status).toBe(201);
    const asset = (await res.json()) as AssetJson;
    expect(asset).toMatchObject({ status: "pending", rejectionReason: null });
    expect(asset.ref).toBe(`upload:${asset.id}`);
    expect(blobs.objects.size).toBe(1);

    const list = await handlers.listMyUploads(
      new Request("http://localhost/api/audio/uploads", { headers: { "x-test-user": "ana" } }),
    );
    expect(((await list.json()) as { items: AssetJson[] }).items).toHaveLength(1);
  });

  it("fichero no MP3 → 415 con error claro", async () => {
    const { handlers, uploadRequest } = setup();
    const res = await handlers.upload(
      uploadRequest("ana", {
        bytes: new TextEncoder().encode("esto no es audio"),
        name: "notas.txt",
        type: "text/plain",
      }),
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as ErrorJson;
    expect(body.error).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(body.error.message).toContain("Solo se aceptan ficheros MP3");
  });

  it("fichero demasiado grande → 413 con error claro", async () => {
    const { handlers, uploadRequest, audio } = setup();
    const res = await handlers.upload(
      uploadRequest("ana", {
        bytes: new Uint8Array(audio.limits.maxBytes + 1),
        name: "enorme.mp3",
        type: "audio/mpeg",
      }),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorJson;
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.error.message).toContain("10 MB");
  });

  it("sin sesión → 401; sin declarar derechos → 422; sin fichero → 422", async () => {
    const { handlers, uploadRequest, mp3 } = setup();
    expect((await handlers.upload(uploadRequest(undefined, mp3()))).status).toBe(401);
    expect((await handlers.upload(uploadRequest("ana", mp3(), false))).status).toBe(422);
    const empty = new Request("http://localhost/api/audio/uploads", {
      method: "POST",
      body: new FormData(),
      headers: { "x-test-user": "ana" },
    });
    expect((await handlers.upload(empty)).status).toBe(422);
  });
});

describe("moderación de audio subido", () => {
  it("aprobado → usable al publicar; rechazado → no usable y con motivo", async () => {
    const { audio, upload, review, mp3 } = setup();
    const ok = (await (await upload("ana")).json()) as AssetJson;
    const ko = (await (await upload("ana", mp3("voz.mp3"))).json()) as AssetJson;

    // Pendientes: ninguna se puede publicar.
    expect(await audio.checkRefsForPublish(ana, [ok.ref, ko.ref])).toHaveLength(2);

    expect((await review("ana", ok.id, { decision: "approved" })).status).toBe(403);
    const approved = await review("mod", ok.id, { decision: "approved" });
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as AssetJson).status).toBe("approved");

    expect((await review("mod", ko.id, { decision: "rejected" })).status).toBe(422);
    const rejected = await review("mod", ko.id, {
      decision: "rejected",
      reason: "Música con copyright",
    });
    expect(((await rejected.json()) as AssetJson).rejectionReason).toBe("Música con copyright");
    expect((await review("mod", ko.id, { decision: "approved" })).status).toBe(409);

    expect(await audio.checkRefsForPublish(ana, [ok.ref, ko.ref])).toMatchObject([
      { ref: ko.ref, code: "AUDIO_REJECTED", rejectionReason: "Música con copyright" },
    ]);
  });

  it("la cola solo la ven moderadores", async () => {
    const { handlers, upload } = setup();
    await upload("ana");
    const queue = (user: string) =>
      handlers.listModerationQueue(
        new Request("http://localhost/api/admin/audio?status=pending", {
          headers: { "x-test-user": user },
        }),
      );
    expect((await queue("ana")).status).toBe(403);
    const res = await queue("mod");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ ownerId: string }> };
    expect(body.items).toMatchObject([{ ownerId: "ana" }]);
  });

  it("un usuario no puede usar ni escuchar el audio subido por otro", async () => {
    const { audio, handlers, upload, review } = setup();
    const asset = (await (await upload("ana")).json()) as AssetJson;
    await review("mod", asset.id, { decision: "approved" });
    const get = (user: string) =>
      handlers.getUpload(
        new Request(`http://localhost/api/audio/uploads/${asset.id}`, {
          headers: { "x-test-user": user },
        }),
        { params: Promise.resolve({ id: asset.id }) },
      );
    expect((await get("bruno")).status).toBe(404);
    const own = (await (await get("ana")).json()) as AssetJson;
    expect(own.previewUrl).toMatch(/^memory:\/\/uploads\/audio\/ana\//);
    expect(await audio.checkRefsForPublish(bruno, [asset.ref])).toMatchObject([
      { code: "FORBIDDEN" },
    ]);
  });
});

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale: "es", messages: es, children: element }),
  );
}

// Cobertura de <LocalizedAudioField> y <AudioSourceSelect> (el <select> de la
// biblioteca/subidas): test/audio-field-select.test.ts, con jsdom + Testing
// Library — el Select de shadcn (Radix) monta su listbox en un Portal que
// `renderToStaticMarkup` no renderiza.
describe("<AudioUploadButton>", () => {
  it("pinta la subida con los límites y la declaración de derechos", () => {
    const html = render(
      createElement(AudioUploadButton, {
        onUpload: async () => undefined,
        maxBytes: 10 * 1024 * 1024,
        maxDurationMs: 10 * 60 * 1000,
      }),
    );
    expect(html).toContain("Solo MP3, hasta 10 MB y 10 min.");
    expect(html).toContain('accept="audio/mpeg,.mp3"');
    expect(html).toContain("Declaro que tengo los derechos");
  });
});
