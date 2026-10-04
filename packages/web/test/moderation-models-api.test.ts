import {
  ANONYMOUS_ACTOR,
  createInMemoryModerationStore,
  createModerationService,
  type Actor,
} from "@escaperoom/shared/services";
import { parseRoomPackage } from "@escaperoom/shared/schemas";
import { describe, expect, it, vi } from "vitest";
import { createModerationModelsHandlers } from "../src/server/rest/moderation-models";
import { makeRoom3D } from "../../game-runtime/test/fixtures/room-3d";

const ROOM = "11111111-1111-4111-8111-111111111111";
const actor = (userId: string): Actor => ({ userId, organizationId: null, role: "member" });

const roomPackage = parseRoomPackage(
  (() => {
    const pkg = makeRoom3D();
    pkg.world3d!.models["suelo-test"]!.ref = "r2://assets/rooms/r/aaa.glb";
    pkg.world3d!.models["arca-test"]!.ref = "r2://assets/rooms/r/bbb.glb";
    return pkg;
  })(),
);

function setup(opts: { pkg?: typeof roomPackage | null; fail?: string[] } = {}) {
  const store = createInMemoryModerationStore({
    moderatorIds: ["mod"],
    rooms: [{ id: ROOM, authorId: "autora", status: "published", title: "Sala" }],
  });
  const introMedia = {
    describeModel: vi.fn(async (_access: unknown, ref: string) => {
      if (opts.fail?.includes(ref)) throw new Error("GLB corrupto");
      return {
        ref,
        size: { w: 1, d: 2, hgt: 3 },
        colliders: [],
        clips: ["abrir"],
        triangles: 500,
        byteSize: 4096,
      };
    }),
    resolveMediaRef: vi.fn(async (_access: unknown, ref: string) => `key:${ref}`),
    signedUrl: vi.fn(async (key: string, o?: { expiresIn?: number }) => `https://s/${key}?e=${o?.expiresIn}`),
  };
  const load = vi.fn(async () => (opts.pkg === undefined ? roomPackage : opts.pkg));
  const handlers = createModerationModelsHandlers({
    moderation: createModerationService({ store }),
    introMedia,
    resolveActor: async (req) =>
      req.headers.get("x-test-user") ? actor(req.headers.get("x-test-user")!) : ANONYMOUS_ACTOR,
    loadLatestPublishedPackage: load,
  });
  const call = (user?: string, roomId = ROOM) =>
    handlers.listRoomModels(
      new Request(`http://x/api/admin/moderation/rooms/${roomId}/models`, {
        headers: user ? { "x-test-user": user } : {},
      }),
      { params: Promise.resolve({ roomId }) },
    );
  return { call, introMedia, load };
}

describe("GET /api/admin/moderation/rooms/:roomId/models", () => {
  it("anónimo → 401, sin permisos de moderación → 403, y no lee nada", async () => {
    const { call, load } = setup();
    expect((await call()).status).toBe(401);
    expect((await call("jugadora")).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });

  it("un moderador recibe los modelos con URL firmada de 1 h y medidas", async () => {
    const { call, introMedia } = setup();
    const response = await call("mod");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { models: Record<string, unknown>[] };
    expect(body.models).toEqual([
      {
        id: "suelo-test",
        label: "Suelo de prueba",
        url: "https://s/key:r2://assets/rooms/r/aaa.glb?e=3600",
        size: { w: 1, d: 2, hgt: 3 },
        triangles: 500,
        byteSize: 4096,
        clips: ["abrir"],
      },
      expect.objectContaining({ id: "arca-test" }),
    ]);
    // Versión publicada: sin actor ni roomId (solo claves publicadas).
    expect(introMedia.describeModel.mock.calls.every((c) => c[0] === null)).toBe(true);
  });

  it("sala sin versión publicada, sin modelos o con id no válido → lista vacía", async () => {
    expect(await (await setup({ pkg: null }).call("mod")).json()).toEqual({ models: [] });
    const flat = parseRoomPackage(makeRoom3D());
    flat.world3d!.models = {};
    expect(await (await setup({ pkg: flat }).call("mod")).json()).toEqual({ models: [] });
    const { call, load } = setup();
    expect(await (await call("mod", "no-es-uuid")).json()).toEqual({ models: [] });
    expect(load).not.toHaveBeenCalled();
  });

  it("un modelo que falla al describirse se omite", async () => {
    const { call } = setup({ fail: ["r2://assets/rooms/r/aaa.glb"] });
    const body = (await (await call("mod")).json()) as { models: { id: string }[] };
    expect(body.models.map((m) => m.id)).toEqual(["arca-test"]);
  });
});
