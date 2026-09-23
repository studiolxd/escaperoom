import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  createInMemoryPublishedAssetStorage,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPublishStore,
  createPublishConfirmationService,
  createRoomPublishService,
  createUnavailablePublishAssetSource,
  type Actor,
} from "@escaperoom/shared/services";
import { describe, expect, it } from "vitest";
import { createPublishConfirmHandlers } from "../src/server/rest/publish-confirm";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

type ErrorJson = { error: { code: string; message: string } };

/**
 * `POST /api/publish-confirm` (ticket 4.5) con stores en memoria. El "draft"
 * es un RoomPackage mutable que devuelve el serializador (como en
 * room-publish-api.test.ts).
 */
function setup(opts: { disabled?: boolean } = {}) {
  let draft: RoomPackage = structuredClone(reyAldric);
  const store = createInMemoryRoomPublishStore([
    { id: ROOM_ID, authorId: author.userId, status: "draft" },
  ]);
  const publish = createRoomPublishService({
    store,
    drafts: createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]),
    serializer: () => structuredClone(draft),
    assets: createUnavailablePublishAssetSource(),
    storage: createInMemoryPublishedAssetStorage(),
  });
  const confirmations = createPublishConfirmationService({
    publish,
    config: { secret: "secreto-de-test", ttlSeconds: 600 },
  });
  const actors: Record<string, Actor> = { autora: author, otro: intruder };
  const handlers = createPublishConfirmHandlers({
    confirmations: opts.disabled ? null : confirmations,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
  });

  return {
    store,
    confirmations,
    editDraft(fn: (pkg: RoomPackage) => void) {
      draft = structuredClone(draft);
      fn(draft);
    },
    post: (body: unknown, user?: string, extra: Record<string, string> = {}) =>
      handlers.postConfirm(
        new Request("http://localhost/api/publish-confirm", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(user ? { "x-test-user": user } : {}),
            ...extra,
          },
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
      ),
  };
}

// Cada paso vuelve a correr el validador (~0,3 s en el Rey Aldric; CI es más lento).
describe("POST /api/publish-confirm (confirmación humana, ticket 4.5)", { timeout: 30_000 }, () => {
  it("el autor confirma con su sesión y se crea la versión (201)", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "Estreno" });
    expect(await api.store.listVersions(ROOM_ID)).toEqual([]);

    const res = await api.post({ token }, "autora", { "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { version: { semver: string; changelog: string } };
    expect(body.version).toMatchObject({ semver: "1.0.0", changelog: "Estreno" });
    expect(await api.store.listVersions(ROOM_ID)).toHaveLength(1);

    // Reutilizar el enlace no publica otra vez.
    const again = await api.post({ token }, "autora");
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorJson).error.code).toBe("VERSION_CHANGED");
  });

  it("si el draft cambió desde la solicitud responde 409 DRAFT_CHANGED y no publica", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    api.editDraft((pkg) => (pkg.meta.title = "Otro título"));
    const res = await api.post({ token }, "autora");
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorJson).error.code).toBe("DRAFT_CHANGED");
    expect(await api.store.listVersions(ROOM_ID)).toEqual([]);
  });

  it("solo el autor con sesión: 401 sin sesión, 403 con otra cuenta", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    const anonymous = await api.post({ token });
    expect(anonymous.status).toBe(401);
    const other = await api.post({ token }, "otro");
    expect(other.status).toBe(403);
    expect(((await other.json()) as ErrorJson).error.code).toBe("FORBIDDEN");
    expect(await api.store.listVersions(ROOM_ID)).toEqual([]);
  });

  it("rechaza peticiones de otros sitios, tokens inválidos y cuerpos sin token", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    const crossSite = await api.post({ token }, "autora", { "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect(((await crossSite.json()) as ErrorJson).error.code).toBe("CROSS_SITE");

    const invalid = await api.post({ token: `${token}x` }, "autora");
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as ErrorJson).error.code).toBe("INVALID_TOKEN");

    for (const body of [{}, "no es json", { token: 3 }]) {
      const res = await api.post(body, "autora");
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorJson).error.code).toBe("VALIDATION_ERROR");
    }
    expect(await api.store.listVersions(ROOM_ID)).toEqual([]);
  });

  it("un draft que pasa a rojo tras la solicitud tampoco se publica (409 DRAFT_CHANGED)", async () => {
    const api = setup();
    const { token } = await api.confirmations.request(author, ROOM_ID, { versionNotes: "v1" });
    api.editDraft((pkg) => (pkg.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = []));
    const res = await api.post({ token }, "autora");
    // La huella ya no coincide: el draft cambió (se comprueba antes que el validador).
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorJson).error.code).toBe("DRAFT_CHANGED");
  });

  it("sin configuración responde 503", async () => {
    const api = setup({ disabled: true });
    const res = await api.post({ token: "x~y" }, "autora");
    expect(res.status).toBe(503);
    expect(((await res.json()) as ErrorJson).error.code).toBe("PUBLISH_CONFIRM_DISABLED");
  });
});
