import { describe, expect, it } from "vitest";
import { findLibraryTrack, uploadAudioRef } from "../src/audio";
import {
  createInMemoryAudioAssetStore,
  createInMemoryAudioBlobStore,
  createIntroAudioKeyResolver,
  createIntroAudioUrlResolver,
} from "../src/services";

const AUTHOR = "autora";
const OTHER = "otra-persona";

function seedUpload(store: ReturnType<typeof createInMemoryAudioAssetStore>, ownerId: string) {
  store.rows.set("11111111-1111-4111-8111-111111111111", {
    id: "11111111-1111-4111-8111-111111111111",
    ownerId,
    organizationId: null,
    storageKey: `generated/audio/${ownerId}/11111111-1111-4111-8111-111111111111.mp3`,
    originalFilename: "narracion.mp3",
    contentType: "audio/mpeg",
    byteSize: 1234,
    durationMs: 5000,
    status: "approved",
    rejectionReason: null,
    rightsDeclaredAt: new Date(),
    createdAt: new Date(),
    source: "ai_generated",
    generationText: "Hola",
    generationVoiceId: "voz-1",
    generationCreditsCost: 1,
  });
}

describe("createIntroAudioKeyResolver — narración de la introducción (audioUrl)", () => {
  it("resuelve una pista de la biblioteca a su clave del bucket, en borrador", async () => {
    const store = createInMemoryAudioAssetStore();
    const resolve = createIntroAudioKeyResolver({ store });
    const track = findLibraryTrack("music-dungeon-ambience");
    expect(track).toBeDefined();
    const key = await resolve({ kind: "draft", roomAuthorId: AUTHOR }, `library:${track!.id}`);
    expect(key).toBe(track!.storageKey);
  });

  it("resuelve una subida propia del autor de la sala, y solo la del autor", async () => {
    const store = createInMemoryAudioAssetStore();
    seedUpload(store, AUTHOR);
    const resolve = createIntroAudioKeyResolver({ store });
    const ref = uploadAudioRef("11111111-1111-4111-8111-111111111111");
    expect(await resolve({ kind: "draft", roomAuthorId: AUTHOR }, ref)).toBe(
      `generated/audio/${AUTHOR}/11111111-1111-4111-8111-111111111111.mp3`,
    );
    expect(await resolve({ kind: "draft", roomAuthorId: OTHER }, ref)).toBeNull();
  });

  it("una clave publicada (r2://) solo se sirve en acceso `published`", async () => {
    const store = createInMemoryAudioAssetStore();
    const resolve = createIntroAudioKeyResolver({ store });
    const key = "assets/rooms/aaa/bbb.mp3";
    expect(await resolve({ kind: "published" }, `r2://${key}`)).toBe(key);
    expect(await resolve({ kind: "draft", roomAuthorId: AUTHOR }, `r2://${key}`)).toBeNull();
  });

  it("una referencia de borrador (`upload:`/`library:`) nunca se sirve en `published`", async () => {
    const store = createInMemoryAudioAssetStore();
    seedUpload(store, AUTHOR);
    const resolve = createIntroAudioKeyResolver({ store });
    const ref = uploadAudioRef("11111111-1111-4111-8111-111111111111");
    expect(await resolve({ kind: "published" }, ref)).toBeNull();
  });

  it("null sin asset, no aprobado, o referencia con forma inválida", async () => {
    const store = createInMemoryAudioAssetStore();
    const resolve = createIntroAudioKeyResolver({ store });
    expect(
      await resolve({ kind: "draft", roomAuthorId: AUTHOR }, uploadAudioRef("22222222-2222-4222-8222-222222222222")),
    ).toBeNull();
    expect(await resolve({ kind: "draft", roomAuthorId: AUTHOR }, "no-es-una-ref")).toBeNull();
  });
});

describe("createIntroAudioUrlResolver — nunca lanza", () => {
  it("devuelve la URL firmada de una subida propia, o null si no se puede servir", async () => {
    const store = createInMemoryAudioAssetStore();
    seedUpload(store, AUTHOR);
    const blobs = createInMemoryAudioBlobStore();
    blobs.objects.set(`generated/audio/${AUTHOR}/11111111-1111-4111-8111-111111111111.mp3`, {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
    });
    const resolveUrl = createIntroAudioUrlResolver(
      { kind: "draft", roomAuthorId: AUTHOR },
      { store, blobs },
    );
    const ref = uploadAudioRef("11111111-1111-4111-8111-111111111111");
    expect(await resolveUrl(ref)).toBe(
      `memory://generated/audio/${AUTHOR}/11111111-1111-4111-8111-111111111111.mp3`,
    );
    expect(await resolveUrl("upload:33333333-3333-4333-8333-333333333333")).toBeNull();
  });
});
