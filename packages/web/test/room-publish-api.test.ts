import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  createInMemoryPublishedAssetStorage,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPublishStore,
  createRoomPublishService,
  createUnavailablePublishAssetSource,
  createRoomDraftService,
  type Actor,
  type RoomPackageSerializer,
} from "@escaperoom/shared/services";
import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createRoomPublishHandlers } from "../src/server/rest/room-publish";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

type VersionJson = {
  id: string;
  semver: string;
  changelog: string | null;
  packageFormat: string;
  assetsHash: string;
  publishedAt: string;
};
type ErrorJson = {
  error: {
    code: string;
    message: string;
    reportText?: string;
    report?: { ok: boolean };
    issues?: unknown[];
  };
};

/**
 * Handlers REST con stores en memoria. El "draft" es un RoomPackage mutable
 * que devuelve el serializador (el mapeo real doc → RoomPackage es de 3.1).
 */
function setup(opts: { serializer?: RoomPackageSerializer | null } = {}) {
  let draft: RoomPackage = structuredClone(reyAldric);
  const store = createInMemoryRoomPublishStore([
    { id: ROOM_ID, authorId: author.userId, status: "draft" },
  ]);
  const publish = createRoomPublishService({
    store,
    drafts: createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]),
    serializer: opts.serializer === undefined ? () => structuredClone(draft) : opts.serializer,
    assets: createUnavailablePublishAssetSource(),
    storage: createInMemoryPublishedAssetStorage(),
  });
  const actors: Record<string, Actor> = { autora: author, otro: intruder };
  const handlers = createRoomPublishHandlers({
    publish,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
  });
  const headers = (user?: string): Record<string, string> => (user ? { "x-test-user": user } : {});
  const base = `http://localhost/api/rooms/${ROOM_ID}`;

  return {
    editDraft(fn: (pkg: RoomPackage) => void) {
      draft = structuredClone(draft);
      fn(draft);
    },
    postPublish: (body: unknown, user?: string, roomId = ROOM_ID) =>
      handlers.postPublish(
        new Request(`${base}/publish`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers(user) },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
        { params: Promise.resolve({ roomId }) },
      ),
    getVersions: (user?: string) =>
      handlers.getVersions(new Request(`${base}/versions`, { headers: headers(user) }), {
        params: Promise.resolve({ roomId: ROOM_ID }),
      }),
    getPackage: (versionId: string, user?: string) =>
      handlers.getVersionPackage(
        new Request(`${base}/versions/${versionId}/package`, { headers: headers(user) }),
        { params: Promise.resolve({ roomId: ROOM_ID, versionId }) },
      ),
  };
}

describe("REST de publicación (specs/13 §4)", () => {
  it("POST /publish crea la versión (201) y el paquete queda congelado", async () => {
    const api = setup();
    const res = await api.postPublish({ changelog: "Estreno" }, "autora");
    expect(res.status).toBe(201);
    const { version } = (await res.json()) as { version: VersionJson };
    expect(version).toMatchObject({ semver: "1.0.0", changelog: "Estreno", packageFormat: "1" });
    expect(version.assetsHash).toMatch(/^sha256:/);

    api.editDraft((pkg) => (pkg.meta.title = "Otro título"));
    const pkgRes = await api.getPackage(version.id, "autora");
    expect(pkgRes.status).toBe(200);
    expect(pkgRes.headers.get("cache-control")).toContain("no-store");
    const body = (await pkgRes.json()) as { package: RoomPackage };
    expect(body.package.meta.title).toBe("La Maldición del Rey Aldric");

    const second = await api.postPublish({}, "autora");
    expect(second.status).toBe(201);
    const list = (await (await api.getVersions()).json()) as { items: VersionJson[] };
    expect(list.items.map((v) => v.semver)).toEqual(["1.0.1", "1.0.0"]);
    expect(list.items[0]).not.toHaveProperty("package");
  });

  it("un dead end no se publica: 422 VALIDATION_FAILED con el informe", async () => {
    const api = setup();
    api.editDraft((pkg) => {
      pkg.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = [];
    });
    const res = await api.postPublish({}, "autora");
    expect(res.status).toBe(422);
    const { error } = (await res.json()) as ErrorJson;
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.report?.ok).toBe(false);
    expect(error.reportText).toContain("❌");
    expect(error.reportText).toContain("p-llave-cuadro");
    const list = (await (await api.getVersions()).json()) as { items: unknown[] };
    expect(list.items).toEqual([]);
  });

  it("permisos: 401 sin sesión, 403 a otro usuario, 404 sala inexistente", async () => {
    const api = setup();
    expect((await api.postPublish({})).status).toBe(401);
    const forbidden = await api.postPublish({}, "otro");
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as ErrorJson).error.code).toBe("FORBIDDEN");
    expect(
      (await api.postPublish({}, "autora", "99999999-9999-4999-8999-999999999999")).status,
    ).toBe(404);

    const created = (await (await api.postPublish({}, "autora")).json()) as {
      version: VersionJson;
    };
    expect((await api.getPackage(created.version.id)).status).toBe(401);
    expect((await api.getPackage(created.version.id, "otro")).status).toBe(403);
    expect((await api.getVersions()).status).toBe(200);
  });

  it("entrada inválida → 400; semver repetido → 409", async () => {
    const api = setup();
    expect((await api.postPublish("{no-json", "autora")).status).toBe(400);
    expect((await api.postPublish({ semver: 3 }, "autora")).status).toBe(400);
    expect((await api.postPublish({ semver: "2.0.0" }, "autora")).status).toBe(201);
    const conflict = await api.postPublish({ semver: "2.0.0" }, "autora");
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as ErrorJson).error.code).toBe("VERSION_CONFLICT");
  });

  it("con la serialización real del editor (3.1) congela el draft Yjs guardado", async () => {
    const drafts = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
    await createRoomDraftService({ store: drafts }).appendUpdate(
      author,
      ROOM_ID,
      Y.encodeStateAsUpdate(roomPackageToDoc(reyAldric)),
    );
    const publish = createRoomPublishService({
      store: createInMemoryRoomPublishStore([
        { id: ROOM_ID, authorId: author.userId, status: "draft" },
      ]),
      drafts,
      serializer: roomDocToPackage,
      assets: createUnavailablePublishAssetSource(),
      storage: createInMemoryPublishedAssetStorage(),
    });
    const handlers = createRoomPublishHandlers({ publish, resolveActor: async () => author });
    const res = await handlers.postPublish(
      new Request(`http://localhost/api/rooms/${ROOM_ID}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ roomId: ROOM_ID }) },
    );
    expect(res.status).toBe(201);
    const { version } = (await res.json()) as { version: VersionJson };
    const pkgRes = await handlers.getVersionPackage(
      new Request(`http://localhost/api/rooms/${ROOM_ID}/versions/${version.id}/package`),
      { params: Promise.resolve({ roomId: ROOM_ID, versionId: version.id }) },
    );
    const body = (await pkgRes.json()) as { package: RoomPackage };
    expect(body.package.map).toEqual(reyAldric.map);
    expect(body.package.objects).toEqual(reyAldric.objects);
    expect(body.package.rules).toEqual(reyAldric.rules);
  });

  it("sin serializador (3.1 pendiente) → 501 SERIALIZER_UNAVAILABLE", async () => {
    const api = setup({ serializer: null });
    const res = await api.postPublish({}, "autora");
    expect(res.status).toBe(501);
    expect(((await res.json()) as ErrorJson).error.code).toBe("SERIALIZER_UNAVAILABLE");
  });
});
