import { describe, expect, it } from "vitest";
import {
  AUDIO_LIBRARY,
  createSilentMp3,
  libraryAudioRef,
  libraryTrackTitle,
  parseAudioRef,
  parseMp3,
  uploadAudioRef,
} from "../src/audio";
import {
  ANONYMOUS_ACTOR,
  AudioError,
  audioAssetRef,
  createAudioAssetService,
  createInMemoryAudioAssetStore,
  createInMemoryAudioBlobStore,
  type Actor,
  type AudioModerationProvider,
} from "../src/services";

const ana: Actor = { userId: "user-ana", organizationId: "org-1", role: "member" };
const bruno: Actor = { userId: "user-bruno", organizationId: null, role: "member" };
const mod: Actor = { userId: "user-mod", organizationId: null, role: "member" };

let seq = 0;
function setup(opts: { moderation?: AudioModerationProvider; maxDurationMs?: number } = {}) {
  const store = createInMemoryAudioAssetStore({ moderatorIds: [mod.userId] });
  const blobs = createInMemoryAudioBlobStore();
  const service = createAudioAssetService({
    store,
    blobs,
    moderation: opts.moderation,
    limits: opts.maxDurationMs ? { maxDurationMs: opts.maxDurationMs } : {},
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  });
  return { store, blobs, service };
}

const mp3 = (ms = 1000) => ({
  filename: "narrador.mp3",
  contentType: "audio/mpeg",
  bytes: createSilentMp3(ms),
  rightsDeclared: true,
});

async function expectAudioError(promise: Promise<unknown>, code: string): Promise<AudioError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AudioError);
  expect((err as AudioError).code).toBe(code);
  return err as AudioError;
}

describe("parseMp3", () => {
  it("mide la duración de un MP3 (con y sin ID3v2)", () => {
    const info = parseMp3(createSilentMp3(2000));
    expect(info?.sampleRate).toBe(44100);
    expect(info?.bitrateKbps).toBe(128);
    expect(info!.durationMs).toBeGreaterThanOrEqual(2000);
    expect(info!.durationMs).toBeLessThan(2030);
    expect(parseMp3(createSilentMp3(500, { id3: true }))?.durationMs).toBeGreaterThanOrEqual(500);
  });

  it("rechaza lo que no es MP3", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const wav = new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt ");
    const ogg = new TextEncoder().encode("OggS\0\x02\0\0\0\0\0\0\0\0");
    expect(parseMp3(png)).toBeNull();
    expect(parseMp3(wav)).toBeNull();
    expect(parseMp3(ogg)).toBeNull();
    expect(parseMp3(new Uint8Array())).toBeNull();
    // Una sola cabecera suelta no basta.
    expect(parseMp3(createSilentMp3(1000).slice(0, 500))).toBeNull();
  });
});

describe("biblioteca y referencias", () => {
  it("el manifiesto trae licencia y créditos en cada pista", () => {
    expect(AUDIO_LIBRARY.length).toBeGreaterThanOrEqual(2);
    expect(new Set(AUDIO_LIBRARY.map((t) => t.id)).size).toBe(AUDIO_LIBRARY.length);
    for (const track of AUDIO_LIBRARY) {
      expect(track.license.spdx).toBeTruthy();
      expect(track.credits.author).toBeTruthy();
      expect(track.storageKey).toBe(`library/audio/${track.id}.mp3`);
    }
    const music = AUDIO_LIBRARY.find((t) => t.kind === "music")!;
    expect(libraryTrackTitle(music, "es")).toBe("Ambiente de mazmorra");
    expect(libraryTrackTitle(music, "nl")).toBe("Dungeon ambience");
  });

  it("interpreta referencias library:/upload: y descarta el resto", () => {
    expect(parseAudioRef(libraryAudioRef("sfx-door-creak"))).toEqual({
      source: "library",
      trackId: "sfx-door-creak",
    });
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(parseAudioRef(uploadAudioRef(id))).toEqual({ source: "upload", assetId: id });
    expect(parseAudioRef("https://evil.example/x.mp3")).toBeNull();
    expect(parseAudioRef("upload:../../x")).toBeNull();
  });

  it("filtra la biblioteca por tipo", () => {
    const { service } = setup();
    expect(service.listLibrary({ kind: "music" }).every((t) => t.kind === "music")).toBe(true);
    expect(service.listLibrary()).toHaveLength(AUDIO_LIBRARY.length);
    expect(() => service.listLibrary({ kind: "podcast" })).toThrow(AudioError);
  });

  it("una pista de la biblioteca es usable al publicar sin moderación", async () => {
    const { service } = setup();
    const resolved = await service.resolveAudioRef(
      ANONYMOUS_ACTOR,
      libraryAudioRef("music-dungeon-ambience"),
      "publish",
    );
    expect(resolved).toMatchObject({
      source: "library",
      storageKey: "library/audio/music-dungeon-ambience.mp3",
    });
    await expectAudioError(
      service.resolveAudioRef(ana, libraryAudioRef("no-existe"), "draft"),
      "NOT_FOUND",
    );
  });
});

describe("subida propia", () => {
  it("un MP3 válido queda pendiente de moderación y almacenado", async () => {
    const { service, blobs } = setup();
    const asset = await service.uploadAudio(ana, mp3(1500));
    expect(asset).toMatchObject({
      ownerId: ana.userId,
      organizationId: "org-1",
      status: "pending",
      contentType: "audio/mpeg",
      originalFilename: "narrador.mp3",
      rejectionReason: null,
    });
    expect(asset.durationMs).toBeGreaterThanOrEqual(1500);
    expect(asset.storageKey).toBe(`uploads/audio/${ana.userId}/${asset.id}.mp3`);
    expect(blobs.objects.get(asset.storageKey)?.contentType).toBe("audio/mpeg");
    expect(await service.listMyUploads(ana)).toHaveLength(1);
    expect(await service.listMyUploads(bruno)).toHaveLength(0);
  });

  it("pendiente: usable en el borrador de su dueño, no al publicar", async () => {
    const { service } = setup();
    const ref = audioAssetRef(await service.uploadAudio(ana, mp3()));
    await expect(service.resolveAudioRef(ana, ref, "draft")).resolves.toMatchObject({
      source: "upload",
      status: "pending",
    });
    const err = await expectAudioError(
      service.resolveAudioRef(ana, ref, "publish"),
      "AUDIO_PENDING_MODERATION",
    );
    expect(err.message).toContain("pendiente de moderación");
  });

  it("aprobado → usable al publicar", async () => {
    const { service } = setup();
    const asset = await service.uploadAudio(ana, mp3());
    const reviewed = await service.reviewUpload(mod, asset.id, { decision: "approved" });
    expect(reviewed).toMatchObject({ status: "approved", reviewedBy: mod.userId });
    expect(reviewed.reviewedAt).toBeInstanceOf(Date);
    await expect(
      service.resolveAudioRef(ana, audioAssetRef(asset), "publish"),
    ).resolves.toMatchObject({ status: "approved" });
    expect(await service.checkRefsForPublish(ana, [audioAssetRef(asset)])).toEqual([]);
  });

  it("rechazado → no usable ni en el borrador, y con motivo", async () => {
    const { service } = setup();
    const asset = await service.uploadAudio(ana, mp3());
    await expectAudioError(
      service.reviewUpload(mod, asset.id, { decision: "rejected" }),
      "VALIDATION_ERROR",
    );
    await service.reviewUpload(mod, asset.id, {
      decision: "rejected",
      reason: "Contiene una voz reconocible sin consentimiento",
    });
    const err = await expectAudioError(
      service.resolveAudioRef(ana, audioAssetRef(asset), "draft"),
      "AUDIO_REJECTED",
    );
    expect(err.rejectionReason).toBe("Contiene una voz reconocible sin consentimiento");
    const [problem] = await service.checkRefsForPublish(ana, [audioAssetRef(asset)]);
    expect(problem).toMatchObject({
      code: "AUDIO_REJECTED",
      rejectionReason: "Contiene una voz reconocible sin consentimiento",
    });
    // Su dueño ve el motivo en su listado, pero ya no se le sirve el audio.
    expect((await service.listMyUploads(ana))[0]?.rejectionReason).toContain("voz reconocible");
    expect((await service.getUpload(ana, asset.id)).previewUrl).toBeNull();
    // Una revisión es definitiva.
    await expectAudioError(
      service.reviewUpload(mod, asset.id, { decision: "approved" }),
      "ALREADY_REVIEWED",
    );
  });

  it("fichero no MP3 → 415 con mensaje claro, sin almacenar nada", async () => {
    const { service, blobs } = setup();
    const err = await expectAudioError(
      service.uploadAudio(ana, {
        ...mp3(),
        filename: "foto.mp3",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
      }),
      "UNSUPPORTED_MEDIA_TYPE",
    );
    expect(err.message).toContain("Solo se aceptan ficheros MP3");
    // Un MP3 real declarado como otro tipo tampoco pasa.
    await expectAudioError(
      service.uploadAudio(ana, { ...mp3(), filename: "a.ogg", contentType: "audio/ogg" }),
      "UNSUPPORTED_MEDIA_TYPE",
    );
    expect(blobs.objects.size).toBe(0);
  });

  it("demasiado grande o demasiado largo → rechazo", async () => {
    const { service } = setup({ maxDurationMs: 2000 });
    const big = new Uint8Array(service.limits.maxBytes + 1);
    const err = await expectAudioError(
      service.uploadAudio(ana, { ...mp3(), bytes: big }),
      "PAYLOAD_TOO_LARGE",
    );
    expect(err.message).toMatch(/el máximo es 10 MB/);
    const long = await expectAudioError(service.uploadAudio(ana, mp3(3000)), "VALIDATION_ERROR");
    expect(long.message).toMatch(/el máximo es 0:02/);
  });

  it("exige sesión y declaración de derechos", async () => {
    const { service } = setup();
    await expectAudioError(service.uploadAudio(ANONYMOUS_ACTOR, mp3()), "UNAUTHORIZED");
    await expectAudioError(
      service.uploadAudio(ana, { ...mp3(), rightsDeclared: false }),
      "VALIDATION_ERROR",
    );
  });

  it("un usuario no puede usar ni ver el audio subido por otro", async () => {
    const { service } = setup();
    const asset = await service.uploadAudio(ana, mp3());
    await service.reviewUpload(mod, asset.id, { decision: "approved" });
    const err = await expectAudioError(
      service.resolveAudioRef(bruno, audioAssetRef(asset), "draft"),
      "FORBIDDEN",
    );
    expect(err.message).toContain("otro usuario");
    expect(await service.checkRefsForPublish(bruno, [audioAssetRef(asset)])).toMatchObject([
      { code: "FORBIDDEN" },
    ]);
    await expectAudioError(service.getUpload(bruno, asset.id), "NOT_FOUND");
    // El dueño y el moderador sí lo escuchan.
    expect((await service.getUpload(ana, asset.id)).previewUrl).toBe(
      `memory://${asset.storageKey}`,
    );
    expect((await service.getUpload(mod, asset.id)).previewUrl).toBeTruthy();
  });

  it("solo moderadores revisan y ven la cola", async () => {
    const { service } = setup();
    const first = await service.uploadAudio(ana, mp3());
    await service.uploadAudio(bruno, mp3());
    await expectAudioError(service.listModerationQueue(ana), "FORBIDDEN");
    await expectAudioError(
      service.reviewUpload(ana, first.id, { decision: "approved" }),
      "FORBIDDEN",
    );
    await expectAudioError(service.listModerationQueue(ANONYMOUS_ACTOR), "UNAUTHORIZED");
    expect(await service.listModerationQueue(mod)).toHaveLength(2);
    await service.reviewUpload(mod, first.id, { decision: "approved" });
    expect(await service.listModerationQueue(mod)).toHaveLength(1);
    expect(await service.listModerationQueue(mod, { status: "approved" })).toHaveLength(1);
  });

  it("el pre-filtro automático marca o bloquea, pero nunca aprueba", async () => {
    const flagging = setup({
      moderation: { precheck: async () => ({ action: "flag", flags: ["third_party_voice"] }) },
    });
    const flagged = await flagging.service.uploadAudio(ana, mp3());
    expect(flagged).toMatchObject({ status: "pending", moderationFlags: ["third_party_voice"] });

    const blocking = setup({
      moderation: { precheck: async () => ({ action: "block", reason: "hash conocido" }) },
    });
    await expectAudioError(blocking.service.uploadAudio(ana, mp3()), "UPLOAD_BLOCKED");
    expect(blocking.blobs.objects.size).toBe(0);
    expect(blocking.store.rows.size).toBe(0);
  });
});
