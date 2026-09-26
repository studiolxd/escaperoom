import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createSilentMp3 } from "../src/audio";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import {
  ANONYMOUS_ACTOR,
  audioAssetRef,
  createAudioAssetService,
  createAudioPublishAssetSource,
  createInMemoryAudioAssetStore,
  createInMemoryAudioBlobStore,
  collectAssetRefs,
  computeAssetsHash,
  createInMemoryPublishedAssetStorage,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPublishStore,
  createRoomDraftService,
  createRoomPublishService,
  createUnavailablePublishAssetSource,
  nextSemver,
  RoomPublishError,
  type Actor,
  type PublishAssetProblem,
  type PublishAssetSource,
  type RoomPackageSerializer,
} from "../src/services";
import type { AssetManifestInput } from "../src/validator";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const AUDIO_OK = "upload:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUDIO_REJECTED_ASSET = "upload:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };
const admin: Actor = { userId: "admin", organizationId: null, role: "member" };

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

/**
 * Serializador de test: el doc guarda el RoomPackage entero como JSON en un
 * mapa. Sustituye al mapeo real doc → RoomPackage (ticket 3.1); la publicación
 * solo depende del puerto.
 */
const jsonSerializer: RoomPackageSerializer = (doc) => {
  const json = doc.getMap<string>("test-package").get("json");
  return json === undefined ? {} : (JSON.parse(json) as unknown);
};

type FakeAsset = { status: "approved" | "rejected"; bytes: Uint8Array };

/** Fuente de assets con moderación simulada (misma forma que `AudioAssetService` de 3.11). */
function fakeAssetSource(assets: Map<string, FakeAsset>): PublishAssetSource & { loads: string[] } {
  const loads: string[] = [];
  return {
    loads,
    async checkRefsForPublish(_actor, refs) {
      return refs.flatMap((ref): PublishAssetProblem[] => {
        const asset = assets.get(ref);
        if (!asset)
          return [{ ref, code: "NOT_FOUND", message: "no existe", rejectionReason: null }];
        if (asset.status === "rejected") {
          return [{ ref, code: "AUDIO_REJECTED", message: "rechazado", rejectionReason: "ruido" }];
        }
        return [];
      });
    },
    async load(_actor, ref) {
      loads.push(ref);
      return { bytes: assets.get(ref)!.bytes, contentType: "audio/mpeg" };
    },
  };
}

function setup(
  opts: {
    serializer?: RoomPackageSerializer | null;
    loadAssetManifest?: (pkg: RoomPackage) => Promise<AssetManifestInput | undefined>;
    runtimeModelCheck?: (pkg: RoomPackage) => void;
  } = {},
) {
  const draftStore = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
  const drafts = createRoomDraftService({ store: draftStore });
  const store = createInMemoryRoomPublishStore(
    [{ id: ROOM_ID, authorId: author.userId, status: "draft" }],
    [admin.userId],
  );
  const storage = createInMemoryPublishedAssetStorage();
  const audio = new Map<string, FakeAsset>([
    [AUDIO_OK, { status: "approved", bytes: new Uint8Array([1, 2, 3]) }],
    [AUDIO_REJECTED_ASSET, { status: "rejected", bytes: new Uint8Array([9]) }],
  ]);
  const assets = fakeAssetSource(audio);
  const service = createRoomPublishService({
    store,
    drafts: draftStore,
    serializer: opts.serializer === undefined ? jsonSerializer : opts.serializer,
    assets,
    storage,
    loadAssetManifest: opts.loadAssetManifest,
    runtimeModelCheck: opts.runtimeModelCheck,
  });

  // Doc "del editor": cada cambio emite un update que se persiste por el draft.
  const doc = new Y.Doc();
  const pending: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => pending.push(u));

  async function writeDraft(pkg: RoomPackage): Promise<void> {
    doc.getMap<string>("test-package").set("json", JSON.stringify(pkg));
    for (const update of pending.splice(0)) await drafts.appendUpdate(author, ROOM_ID, update);
  }

  return { service, store, storage, audio, assets, writeDraft };
}

const clone = (): RoomPackage => structuredClone(reyAldric);

function withDialogAudio(pkg: RoomPackage, ref: string): RoomPackage {
  pkg.dialogs[0]!.text.es!.audioUrl = ref;
  return pkg;
}

async function publishError(promise: Promise<unknown>): Promise<RoomPublishError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RoomPublishError);
  return err as RoomPublishError;
}

describe("publicación — congelar la versión", () => {
  it("publicar congela el RoomPackage: editar el draft después no cambia lo publicado", async () => {
    const { service, store, writeDraft } = setup();
    await writeDraft(clone());

    const first = await service.publish(author, ROOM_ID, { changelog: "Primera versión" });
    expect(first.version.semver).toBe("1.0.0");
    expect(first.version.packageFormat).toBe("roompackage/v1");
    expect(first.version.changelog).toBe("Primera versión");
    expect(first.report.ok).toBe(true);
    expect(store.rooms.get(ROOM_ID)?.status).toBe("published");

    // El autor sigue editando el draft.
    const edited = clone();
    edited.meta.title = "La Maldición del Rey Aldric (director's cut)";
    await writeDraft(edited);

    const frozen = await service.getVersionPackage(author, ROOM_ID, first.version.id);
    expect(frozen.package.meta.title).toBe("La Maldición del Rey Aldric");
    // El servidor fija identidad y versión al congelar.
    expect(frozen.package.meta).toMatchObject({
      id: ROOM_ID,
      authorId: author.userId,
      version: "1.0.0",
      packageFormat: "roompackage/v1",
    });

    // Mutar lo devuelto tampoco toca lo almacenado.
    frozen.package.meta.title = "hackeado";
    const again = await service.getVersionPackage(author, ROOM_ID, first.version.id);
    expect(again.package.meta.title).toBe("La Maldición del Rey Aldric");
  });

  it("publicar dos veces crea versiones sucesivas; la nueva recoge el draft editado", async () => {
    const { service, writeDraft } = setup();
    await writeDraft(clone());
    const v1 = await service.publish(author, ROOM_ID);

    const edited = clone();
    edited.meta.title = "Rey Aldric II";
    await writeDraft(edited);
    const v2 = await service.publish(author, ROOM_ID, { changelog: "Título nuevo" });

    expect([v1.version.semver, v2.version.semver]).toEqual(["1.0.0", "1.0.1"]);
    expect(new Set([v1.version.id, v2.version.id]).size).toBe(2);
    expect(
      (await service.getVersionPackage(author, ROOM_ID, v1.version.id)).package.meta.title,
    ).toBe("La Maldición del Rey Aldric");
    expect(
      (await service.getVersionPackage(author, ROOM_ID, v2.version.id)).package.meta.title,
    ).toBe("Rey Aldric II");

    const listed = await service.listVersions(ANONYMOUS_ACTOR, ROOM_ID);
    expect(listed.map((v) => v.semver)).toEqual(["1.0.1", "1.0.0"]);
    expect(listed[0]).not.toHaveProperty("package");
  });

  it("dos publicaciones simultáneas con el mismo contenido: el lock las serializa y solo una tiene éxito", async () => {
    // ADR-035: con contenido idéntico ya no hay dos versiones "vacías" (1.0.0,
    // 1.0.1); la que pierde la carrera del lock ve NOTHING_TO_PUBLISH porque,
    // para cuando le toca, la otra ya publicó exactamente lo mismo.
    const { service, store, writeDraft } = setup();
    await writeDraft(clone());
    const results = await Promise.allSettled([
      service.publish(author, ROOM_ID),
      service.publish(author, ROOM_ID),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as unknown;
    expect(reason).toBeInstanceOf(RoomPublishError);
    expect((reason as RoomPublishError).code).toBe("NOTHING_TO_PUBLISH");
    expect(await store.listSemvers(ROOM_ID)).toEqual(["1.0.0"]);
  });

  it("publicar sin ningún cambio respecto a la última versión falla con NOTHING_TO_PUBLISH (ADR-035)", async () => {
    const { service, writeDraft } = setup();
    await writeDraft(clone());
    await service.publish(author, ROOM_ID);

    expect((await publishError(service.publish(author, ROOM_ID))).code).toBe(
      "NOTHING_TO_PUBLISH",
    );
    expect(
      (await publishError(service.publish(author, ROOM_ID, { changelog: "x".repeat(5001) }))).code,
    ).toBe("VALIDATION_ERROR");
  });

  it("modificar el contenido de un puzzle existente (sin añadir ni quitar) sube MINOR", async () => {
    const { service, writeDraft } = setup();
    await writeDraft(clone());
    const v1 = await service.publish(author, ROOM_ID);
    expect(v1.version.semver).toBe("1.0.0");

    const edited = clone();
    const lock = edited.puzzles.find((p) => p.id === "p-candado-arca");
    if (!lock || lock.type !== "code_lock") throw new Error("fixture sin p-candado-arca");
    lock.code = "9999";
    await writeDraft(edited);
    const v2 = await service.publish(author, ROOM_ID);
    expect(v2.version.semver).toBe("1.1.0");
  });
});

describe("publicación — validación en servidor", () => {
  it("un paquete con dead end no se publica: VALIDATION_FAILED con el informe", async () => {
    const { service, storage, writeDraft } = setup();
    const broken = withDialogAudio(clone(), AUDIO_OK);
    broken.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = [];
    await writeDraft(broken);

    const err = await publishError(service.publish(author, ROOM_ID));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.details.report?.ok).toBe(false);
    const deadEnds = err.details.report?.checks.find((c) => c.id === "dead_ends");
    expect(deadEnds?.status).toBe("error");
    expect(deadEnds?.issues.map((i) => i.message)).toContain(
      "el puzzle «p-llave-cuadro» no puede resolverse: el escondite no entrega ningún objeto (grantsItems y keyItemId vacíos)",
    );
    expect(err.details.reportText).toMatch(/❌/u);

    // Nada se sube ni se inserta si la validación falla.
    expect(storage.objects.size).toBe(0);
    expect(await service.listVersions(author, ROOM_ID)).toEqual([]);
  });

  it("un draft que no forma un RoomPackage válido → INVALID_PACKAGE con los campos", async () => {
    const { service, writeDraft } = setup();
    const broken = clone() as unknown as { meta: Record<string, unknown> };
    delete broken.meta.title;
    await writeDraft(broken as unknown as RoomPackage);
    const err = await publishError(service.publish(author, ROOM_ID));
    expect(err.code).toBe("INVALID_PACKAGE");
    expect(err.details.issues?.some((i) => i.path === "meta.title")).toBe(true);
  });

  it("un packageFormat no soportado no se publica", async () => {
    const { service, writeDraft } = setup();
    const pkg = clone();
    pkg.meta.packageFormat = "99";
    await writeDraft(pkg);
    expect((await publishError(service.publish(author, ROOM_ID))).code).toBe(
      "UNSUPPORTED_PACKAGE_FORMAT",
    );
  });

  it("sin serializador cableado (3.1 pendiente) → SERIALIZER_UNAVAILABLE", async () => {
    const { service } = setup({ serializer: null });
    expect((await publishError(service.publish(author, ROOM_ID))).code).toBe(
      "SERIALIZER_UNAVAILABLE",
    );
  });
});

describe("publicación — assets y moderación", () => {
  it("empaqueta los audios aprobados con clave por contenido y reescribe la referencia", async () => {
    const { service, storage, writeDraft } = setup();
    await writeDraft(withDialogAudio(clone(), AUDIO_OK));

    const { version, assets } = await service.publish(author, ROOM_ID);
    expect(assets).toHaveLength(1);
    const [asset] = assets;
    expect(asset!.key).toMatch(new RegExp(`^assets/rooms/${ROOM_ID}/[0-9a-f]{64}\\.mp3$`));
    expect(storage.objects.get(asset!.key)?.bytes).toEqual(new Uint8Array([1, 2, 3]));

    const { package: pkg } = await service.getVersionPackage(author, ROOM_ID, version.id);
    expect(pkg.dialogs[0]!.text.es!.audioUrl).toBe(`r2://${asset!.key}`);
    expect(collectAssetRefs(pkg)).toEqual([]);
    expect(version.assetsHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("un audio rechazado bloquea la publicación (y no se sube nada)", async () => {
    const { service, storage, assets, writeDraft } = setup();
    const pkg = withDialogAudio(clone(), AUDIO_OK);
    pkg.hints[0]!.text.es!.audioUrl = AUDIO_REJECTED_ASSET;
    await writeDraft(pkg);

    const err = await publishError(service.publish(author, ROOM_ID));
    expect(err.code).toBe("ASSETS_NOT_PUBLISHABLE");
    expect(err.details.problems).toEqual([
      expect.objectContaining({ ref: AUDIO_REJECTED_ASSET, code: "AUDIO_REJECTED" }),
    ]);
    expect(assets.loads).toEqual([]);
    expect(storage.objects.size).toBe(0);
  });

  it("sin fuente de assets cableada, un audio del creador nunca se publica", async () => {
    const draftStore = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
    const store = createInMemoryRoomPublishStore([
      { id: ROOM_ID, authorId: author.userId, status: "draft" },
    ]);
    const service = createRoomPublishService({
      store,
      drafts: draftStore,
      serializer: () => withDialogAudio(clone(), "library:ambiente-castillo"),
      assets: createUnavailablePublishAssetSource(),
      storage: createInMemoryPublishedAssetStorage(),
    });
    const err = await publishError(service.publish(author, ROOM_ID));
    expect(err.code).toBe("ASSETS_NOT_PUBLISHABLE");
    expect(err.details.problems?.[0]?.code).toBe("ASSET_SOURCE_UNAVAILABLE");
  });

  it("assetsHash es estable ante el mismo contenido y cambia si cambia un asset", async () => {
    const { service, audio, writeDraft } = setup();
    await writeDraft(withDialogAudio(clone(), AUDIO_OK));

    const a = await service.publish(author, ROOM_ID);
    // Mismo contenido (aunque cambie el texto de la sala): mismo hash.
    const edited = withDialogAudio(clone(), AUDIO_OK);
    edited.meta.description = "Otra descripción";
    await writeDraft(edited);
    const b = await service.publish(author, ROOM_ID);
    expect(b.version.assetsHash).toBe(a.version.assetsHash);

    // Cambia un byte del audio: cambia el hash (y la clave del bucket).
    audio.set(AUDIO_OK, { status: "approved", bytes: new Uint8Array([1, 2, 4]) });
    const c = await service.publish(author, ROOM_ID);
    expect(c.version.assetsHash).not.toBe(a.version.assetsHash);
    expect(c.assets[0]!.key).not.toBe(a.assets[0]!.key);
  });

  it("computeAssetsHash no depende del orden de los assets", () => {
    const assets = [
      { key: "assets/rooms/r/aa.mp3", sha256: "aa" },
      { key: "assets/rooms/r/bb.mp3", sha256: "bb" },
    ];
    const manifest = "r2://assets/packs/medieval-v1/manifest.json";
    const hash = computeAssetsHash({ assetsManifest: manifest, assets });
    expect(computeAssetsHash({ assetsManifest: manifest, assets: [...assets].reverse() })).toBe(
      hash,
    );
    expect(computeAssetsHash({ assetsManifest: "r2://otro/manifest.json", assets })).not.toBe(hash);
  });
});

describe("publicación — integración con el servicio de audio (3.11)", () => {
  function setupWithAudio() {
    const blobs = createInMemoryAudioBlobStore();
    const store = createInMemoryAudioAssetStore();
    const audio = createAudioAssetService({
      store,
      blobs,
      newId: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    let draft = clone();
    const storage = createInMemoryPublishedAssetStorage();
    const service = createRoomPublishService({
      store: createInMemoryRoomPublishStore([
        { id: ROOM_ID, authorId: author.userId, status: "draft" },
      ]),
      drafts: createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]),
      serializer: () => structuredClone(draft),
      assets: createAudioPublishAssetSource({
        audio,
        readObject: async (key) => blobs.objects.get(key)!,
      }),
      storage,
    });
    return {
      audio,
      store,
      service,
      storage,
      setDraft(pkg: RoomPackage) {
        draft = pkg;
      },
    };
  }

  it("un MP3 subido queda disponible al instante y se empaqueta sin moderación previa", async () => {
    const { audio, service, storage, setDraft } = setupWithAudio();
    const bytes = createSilentMp3(1000);
    const upload = await audio.uploadAudio(author, {
      filename: "narrador.mp3",
      contentType: "audio/mpeg",
      bytes,
      rightsDeclared: true,
    });
    setDraft(withDialogAudio(clone(), audioAssetRef(upload)));

    const { assets } = await service.publish(author, ROOM_ID);
    expect(assets).toHaveLength(1);
    expect(storage.objects.get(assets[0]!.key)?.bytes).toEqual(bytes);
  });

  it("un audio rechazado (histórico) bloquea con el motivo de moderación", async () => {
    const { audio, store, service, setDraft } = setupWithAudio();
    const upload = await audio.uploadAudio(author, {
      filename: "grito.mp3",
      contentType: "audio/mpeg",
      bytes: createSilentMp3(500),
      rightsDeclared: true,
    });
    // No hay cola de moderación: un "rejected" solo viene de una decisión
    // humana histórica ya congelada en la fila.
    store.rows.set(upload.id, {
      ...upload,
      status: "rejected",
      rejectionReason: "Contenido inapropiado",
    });
    setDraft(withDialogAudio(clone(), audioAssetRef(upload)));
    const err = await publishError(service.publish(author, ROOM_ID));
    expect(err.details.problems?.[0]).toMatchObject({
      code: "AUDIO_REJECTED",
      rejectionReason: "Contenido inapropiado",
    });
  });
});

describe("publicación — permisos", () => {
  it("sin sesión → UNAUTHORIZED; otro usuario → FORBIDDEN; sala inexistente → NOT_FOUND", async () => {
    const { service, writeDraft } = setup();
    await writeDraft(clone());
    expect((await publishError(service.publish(ANONYMOUS_ACTOR, ROOM_ID))).code).toBe(
      "UNAUTHORIZED",
    );
    expect((await publishError(service.publish(intruder, ROOM_ID))).code).toBe("FORBIDDEN");
    expect((await publishError(service.publish(author, "no-es-uuid"))).code).toBe("NOT_FOUND");
    expect(
      (await publishError(service.publish(author, "99999999-9999-4999-8999-999999999999"))).code,
    ).toBe("NOT_FOUND");
  });

  it("el paquete solo lo leen el autor o un admin; el histórico es público", async () => {
    const { service, writeDraft } = setup();
    await writeDraft(clone());
    const { version } = await service.publish(author, ROOM_ID);

    expect(
      (await publishError(service.getVersionPackage(ANONYMOUS_ACTOR, ROOM_ID, version.id))).code,
    ).toBe("UNAUTHORIZED");
    expect(
      (await publishError(service.getVersionPackage(intruder, ROOM_ID, version.id))).code,
    ).toBe("FORBIDDEN");
    expect((await service.getVersionPackage(admin, ROOM_ID, version.id)).version.id).toBe(
      version.id,
    );
    expect(
      (
        await publishError(
          service.getVersionPackage(author, ROOM_ID, "99999999-9999-4999-8999-999999999999"),
        )
      ).code,
    ).toBe("NOT_FOUND");
    expect(await service.listVersions(ANONYMOUS_ACTOR, ROOM_ID)).toHaveLength(1);
  });

  it("una sala retirada por moderación no se puede publicar", async () => {
    const { service, store, writeDraft } = setup();
    await writeDraft(clone());
    store.rooms.get(ROOM_ID)!.status = "removed";
    expect((await publishError(service.publish(author, ROOM_ID))).code).toBe(
      "ROOM_NOT_PUBLISHABLE",
    );
    expect((await publishError(service.listVersions(intruder, ROOM_ID))).code).toBe("NOT_FOUND");
  });
});

describe("nextSemver", () => {
  it("1.0.0 sin versiones previas, sea cual sea el cambio", () => {
    expect(nextSemver([], "major")).toBe("1.0.0");
    expect(nextSemver([], "patch")).toBe("1.0.0");
  });

  it("bump según la clasificación del cambio, sobre el mayor existente", () => {
    expect(nextSemver(["1.0.0", "1.10.0", "1.9.3"], "patch")).toBe("1.10.1");
    expect(nextSemver(["1.2.3"], "patch")).toBe("1.2.4");
    expect(nextSemver(["1.2.3"], "minor")).toBe("1.3.0");
    expect(nextSemver(["1.2.3"], "major")).toBe("2.0.0");
  });

  it('"none" con versiones previas lanza NOTHING_TO_PUBLISH', () => {
    expect(() => nextSemver(["1.2.3"], "none")).toThrow(RoomPublishError);
  });
});

// ---------------------------------------------------------------------------
// D-13: el check `assets` corre en publish() cuando hay manifiesto disponible
// ---------------------------------------------------------------------------

describe("publicación — manifiesto de assets (D-13)", () => {
  it("sin loadAssetManifest, el check assets no se comprueba (degrada, no bloquea)", async () => {
    const { service, writeDraft } = setup();
    await writeDraft(clone());
    const result = await service.publish(author, ROOM_ID);
    const assetsCheck = result.report.checks.find((c) => c.id === "assets")!;
    expect(assetsCheck.summary).toContain("no comprobados");
  });

  it("con loadAssetManifest resolviendo undefined (clon limpio sin pack:build), degrada igual", async () => {
    const { service, writeDraft } = setup({ loadAssetManifest: async () => undefined });
    await writeDraft(clone());
    const result = await service.publish(author, ROOM_ID);
    const assetsCheck = result.report.checks.find((c) => c.id === "assets")!;
    expect(assetsCheck.summary).toContain("no comprobados");
  });

  it("con manifiesto que no declara un sprite usado, el check assets avisa (no bloquea la publicación)", async () => {
    const { service, writeDraft } = setup({
      loadAssetManifest: async () => ({ tiles: {}, sprites: {}, ui: { icons: {} } }),
    });
    await writeDraft(clone());
    const result = await service.publish(author, ROOM_ID);
    const assetsCheck = result.report.checks.find((c) => c.id === "assets")!;
    expect(assetsCheck.status).toBe("warning");
    expect(assetsCheck.issues.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// D-3: smoke test de `toRuntimeModel` antes de publicar
// ---------------------------------------------------------------------------

describe("publicación — smoke test del runtime (D-3)", () => {
  it("si runtimeModelCheck lanza, publish() falla con VALIDATION_FAILED y no escribe nada", async () => {
    const { service, writeDraft, store } = setup({
      runtimeModelCheck: () => {
        throw new Error("posición fuera de la rejilla");
      },
    });
    await writeDraft(clone());
    const err = await publishError(service.publish(author, ROOM_ID));
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.message).toContain("posición fuera de la rejilla");
    expect(await service.listVersions(author, ROOM_ID)).toHaveLength(0);
    expect(store.rooms.get(ROOM_ID)?.status).toBe("draft");
  });

  it("si runtimeModelCheck pasa, publish() sigue su curso normal", async () => {
    const calls: RoomPackage[] = [];
    const { service, writeDraft } = setup({
      runtimeModelCheck: (pkg) => {
        calls.push(pkg);
      },
    });
    await writeDraft(clone());
    const result = await service.publish(author, ROOM_ID);
    expect(result.report.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
