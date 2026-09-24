import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import {
  ANONYMOUS_ACTOR,
  computePackageHash,
  createInMemoryPublishedAssetStorage,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPublishStore,
  createPublishConfirmationService,
  createRoomDraftService,
  createRoomPublishService,
  createUnavailablePublishAssetSource,
  DEFAULT_PUBLISH_CONFIRM_TTL_SECONDS,
  DEV_PUBLISH_CONFIRM_SECRET,
  latestSemver,
  MAX_PUBLISH_CONFIRM_TTL_SECONDS,
  PublishConfirmationError,
  readPublishConfirmConfig,
  RoomPublishError,
  signPublishConfirmation,
  verifyPublishConfirmation,
  type Actor,
  type RoomPackageSerializer,
} from "../src/services";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "secreto-de-test";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
const clone = (): RoomPackage => structuredClone(reyAldric);

/** Serializador de test (como en room-publish.test.ts): el RoomPackage como JSON en el doc. */
const jsonSerializer: RoomPackageSerializer = (doc) => {
  const json = doc.getMap<string>("test-package").get("json");
  return json === undefined ? {} : (JSON.parse(json) as unknown);
};

function setup(opts: { now?: () => number } = {}) {
  const draftStore = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
  const drafts = createRoomDraftService({ store: draftStore });
  const store = createInMemoryRoomPublishStore([
    { id: ROOM_ID, authorId: author.userId, status: "draft" },
  ]);
  const publish = createRoomPublishService({
    store,
    drafts: draftStore,
    serializer: jsonSerializer,
    assets: createUnavailablePublishAssetSource(),
    storage: createInMemoryPublishedAssetStorage(),
  });
  const confirmations = createPublishConfirmationService({
    publish,
    config: { secret: SECRET, ttlSeconds: 600 },
    now: opts.now,
  });

  const doc = new Y.Doc();
  const pending: Uint8Array[] = [];
  doc.on("update", (u: Uint8Array) => pending.push(u));
  async function writeDraft(pkg: RoomPackage): Promise<void> {
    doc.getMap<string>("test-package").set("json", JSON.stringify(pkg));
    for (const update of pending.splice(0)) await drafts.appendUpdate(author, ROOM_ID, update);
  }
  return { publish, confirmations, store, writeDraft };
}

function broken(): RoomPackage {
  const pkg = clone();
  pkg.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = [];
  return pkg;
}

async function rejection<T extends Error>(promise: Promise<unknown>): Promise<T> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return err as T;
}

describe("computePackageHash / latestSemver", () => {
  it("la huella no depende del orden de las claves y cambia con el contenido", () => {
    const pkg = clone();
    const reordered = Object.fromEntries(Object.entries(pkg).reverse()) as RoomPackage;
    expect(computePackageHash(reordered)).toBe(computePackageHash(pkg));
    expect(computePackageHash(pkg)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const edited = clone();
    edited.meta.title = "Otro título";
    expect(computePackageHash(edited)).not.toBe(computePackageHash(pkg));
  });

  it("latestSemver devuelve la mayor versión o null", () => {
    expect(latestSemver([])).toBeNull();
    expect(latestSemver(["1.0.0", "1.10.0", "1.2.0", "raro"])).toBe("1.10.0");
  });
});

describe("token de confirmación", () => {
  const claims = {
    roomId: ROOM_ID,
    userId: author.userId,
    packageHash: "sha256:abc",
    latestSemver: null,
    versionNotes: "Notas con acentos: «ñandú»",
    issuedAt: Date.UTC(2026, 0, 1),
    expiresAt: Date.UTC(2026, 0, 1, 0, 30),
  };

  it("firma y verifica los claims (redondeados a segundos)", () => {
    const token = signPublishConfirmation(claims, SECRET);
    expect(verifyPublishConfirmation(token, SECRET, claims.issuedAt)).toEqual({ ok: true, claims });
  });

  it("rechaza firma alterada, otro secreto, basura y tokens caducados", () => {
    const token = signPublishConfirmation(claims, SECRET);
    const [body, sig] = token.split("~");
    const forged = signPublishConfirmation({ ...claims, userId: "otro" }, SECRET).split("~")[0];
    expect(verifyPublishConfirmation(`${forged}~${sig}`, SECRET, claims.issuedAt)).toEqual({
      ok: false,
      error: "BAD_SIGNATURE",
    });
    expect(verifyPublishConfirmation(token, "otro-secreto", claims.issuedAt).ok).toBe(false);
    expect(verifyPublishConfirmation(`${body}`, SECRET).ok).toBe(false);
    expect(verifyPublishConfirmation("a~b~c", SECRET).ok).toBe(false);
    expect(verifyPublishConfirmation(token, SECRET, claims.expiresAt)).toEqual({
      ok: false,
      error: "EXPIRED",
    });
  });

  it("readPublishConfirmConfig: secreto de desarrollo, TTL acotado y null en producción", () => {
    expect(readPublishConfirmConfig({ NODE_ENV: "development" })).toEqual({
      secret: DEV_PUBLISH_CONFIRM_SECRET,
      ttlSeconds: DEFAULT_PUBLISH_CONFIRM_TTL_SECONDS,
    });
    expect(readPublishConfirmConfig({ NODE_ENV: "test" })?.secret).toBe(
      DEV_PUBLISH_CONFIRM_SECRET,
    );
    expect(readPublishConfirmConfig({ NODE_ENV: "production" })).toBeNull();
    // E-4: sin NODE_ENV=development|test tampoco hereda el secreto de dev.
    expect(readPublishConfirmConfig({})).toBeNull();
    expect(readPublishConfirmConfig({ NODE_ENV: "staging" })).toBeNull();
    expect(
      readPublishConfirmConfig({
        NODE_ENV: "production",
        PUBLISH_CONFIRM_SECRET: "s",
        PUBLISH_CONFIRM_TTL_SECONDS: "999999",
      }),
    ).toEqual({ secret: "s", ttlSeconds: MAX_PUBLISH_CONFIRM_TTL_SECONDS });
  });
});

describe(
  "checkPublishable — las comprobaciones de publish sin escribir nada",
  { timeout: 30_000 },
  () => {
    it("devuelve la huella, la versión siguiente y el informe; no crea versiones", async () => {
      const { publish, store, writeDraft } = setup();
      await writeDraft(clone());
      const check = await publish.checkPublishable(author, ROOM_ID);
      expect(check).toMatchObject({
        roomId: ROOM_ID,
        title: "La Maldición del Rey Aldric",
        defaultLanguage: "es",
        packageHash: computePackageHash(reyAldric),
        latestSemver: null,
        nextSemver: "1.0.0",
      });
      expect(check.report.ok).toBe(true);
      expect(await store.listVersions(ROOM_ID)).toEqual([]);
    });

    it("con el validador en rojo lanza VALIDATION_FAILED con el informe", async () => {
      const { publish, writeDraft } = setup();
      await writeDraft(broken());
      const err = await rejection<RoomPublishError>(publish.checkPublishable(author, ROOM_ID));
      expect(err.code).toBe("VALIDATION_FAILED");
      expect(err.details.report?.ok).toBe(false);
      expect(err.details.reportText).toContain("❌");
    });
  },
);

// Cada paso vuelve a correr el validador (~0,3 s en el Rey Aldric; CI es más lento).
describe("confirmación humana de la publicación", { timeout: 30_000 }, () => {
  it("request no publica; confirm crea la roomVersion con las notas", async () => {
    const { confirmations, store, writeDraft } = setup();
    await writeDraft(clone());
    const request = await confirmations.request(author, ROOM_ID, { versionNotes: "  v1.0  " });
    expect(request.claims).toMatchObject({
      roomId: ROOM_ID,
      userId: author.userId,
      latestSemver: null,
      versionNotes: "v1.0",
    });
    expect(await store.listVersions(ROOM_ID)).toEqual([]);

    const inspected = await confirmations.inspect(author, request.token);
    expect(inspected.status).toBe("ready");

    const result = await confirmations.confirm(author, request.token);
    expect(result.version).toMatchObject({ semver: "1.0.0", changelog: "v1.0" });
    expect((await store.listVersions(ROOM_ID)).map((v) => v.semver)).toEqual(["1.0.0"]);
  });

  it("request con el validador en rojo falla con el informe y no firma nada", async () => {
    const { confirmations, writeDraft } = setup();
    await writeDraft(broken());
    const err = await rejection<RoomPublishError>(
      confirmations.request(author, ROOM_ID, { versionNotes: "v1.0" }),
    );
    expect(err).toBeInstanceOf(RoomPublishError);
    expect(err.code).toBe("VALIDATION_FAILED");
  });

  it("si el draft cambia tras la solicitud, inspect la marca obsoleta y confirm la rechaza", async () => {
    const { confirmations, store, writeDraft } = setup();
    await writeDraft(clone());
    const { token } = await confirmations.request(author, ROOM_ID, { versionNotes: "v1.0" });
    const edited = clone();
    edited.meta.title = "Título cambiado después";
    await writeDraft(edited);

    expect(await confirmations.inspect(author, token)).toMatchObject({
      status: "stale",
      reason: "DRAFT_CHANGED",
    });
    const err = await rejection<RoomPublishError>(confirmations.confirm(author, token));
    expect(err.code).toBe("DRAFT_CHANGED");
    expect(await store.listVersions(ROOM_ID)).toEqual([]);
  });

  it("un solo uso: tras publicar (o si se publica otra versión) el token ya no sirve", async () => {
    const { publish, confirmations, store, writeDraft } = setup();
    await writeDraft(clone());
    const first = await confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    const second = await confirmations.request(author, ROOM_ID, { versionNotes: "v1 bis" });
    await confirmations.confirm(author, first.token);

    for (const token of [first.token, second.token]) {
      expect(await confirmations.inspect(author, token)).toMatchObject({
        status: "stale",
        reason: "VERSION_CHANGED",
      });
      const err = await rejection<RoomPublishError>(confirmations.confirm(author, token));
      expect(err.code).toBe("VERSION_CHANGED");
    }
    // Publicar desde el editor también invalida las solicitudes previas.
    const third = await confirmations.request(author, ROOM_ID, { versionNotes: "v2" });
    await publish.publish(author, ROOM_ID);
    expect(
      (await rejection<RoomPublishError>(confirmations.confirm(author, third.token))).code,
    ).toBe("VERSION_CHANGED");
    expect((await store.listVersions(ROOM_ID)).map((v) => v.semver)).toEqual(["1.0.1", "1.0.0"]);
  });

  it("dos confirmaciones simultáneas del mismo token publican una sola versión", async () => {
    const { confirmations, store, writeDraft } = setup();
    await writeDraft(clone());
    const { token } = await confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    const results = await Promise.allSettled([
      confirmations.confirm(author, token),
      confirmations.confirm(author, token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as RoomPublishError).code).toBe("VERSION_CHANGED");
    expect(await store.listVersions(ROOM_ID)).toHaveLength(1);
  });

  it("si el validador pasa a rojo tras la solicitud, inspect la bloquea con el informe", async () => {
    const { confirmations, writeDraft } = setup();
    await writeDraft(clone());
    const { token } = await confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    await writeDraft(broken());
    const state = await confirmations.inspect(author, token);
    expect(state.status).toBe("blocked");
    if (state.status === "blocked") {
      expect(state.error.code).toBe("VALIDATION_FAILED");
      expect(state.error.details.report?.ok).toBe(false);
    }
  });

  it("solo el autor que la pidió, con sesión y dentro de plazo", async () => {
    let now = Date.UTC(2026, 0, 1);
    const { confirmations, store, writeDraft } = setup({ now: () => now });
    await writeDraft(clone());
    const { token } = await confirmations.request(author, ROOM_ID, { versionNotes: "v1" });

    const expectCode = async (actor: Actor, t: string, code: string) => {
      const err = await rejection<PublishConfirmationError>(confirmations.confirm(actor, t));
      expect(err).toBeInstanceOf(PublishConfirmationError);
      expect(err.code).toBe(code);
    };
    await expectCode(ANONYMOUS_ACTOR, token, "UNAUTHORIZED");
    await expectCode(intruder, token, "FORBIDDEN");
    await expectCode(author, `${token}x`, "INVALID_TOKEN");
    now += 600 * 1000;
    await expectCode(author, token, "EXPIRED");
    expect(await store.listVersions(ROOM_ID)).toEqual([]);

    // Pedir la publicación de una sala ajena: lo rechaza la publicación de 3.9.
    const foreign = await rejection<RoomPublishError>(
      confirmations.request(intruder, ROOM_ID, { versionNotes: "v1" }),
    );
    expect(foreign.code).toBe("FORBIDDEN");
  });

  it("las notas de versión son obligatorias y acotadas", async () => {
    const { confirmations, writeDraft } = setup();
    await writeDraft(clone());
    for (const versionNotes of ["", "   ", "x".repeat(1001)]) {
      const err = await rejection<PublishConfirmationError>(
        confirmations.request(author, ROOM_ID, { versionNotes }),
      );
      expect(err.code).toBe("VALIDATION_ERROR");
    }
  });
});
