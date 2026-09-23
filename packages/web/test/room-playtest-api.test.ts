import { Client } from "@colyseus/sdk";
import {
  createGameServer,
  DEV_PLAYTEST_SECRET as SERVER_DEV_SECRET,
  PLAYTEST_EXPIRED_CLOSE_CODE as SERVER_EXPIRED_CODE,
  PLAYTEST_INTERNAL_PATH as SERVER_INTERNAL_PATH,
  PLAYTEST_ROOM_NAME as SERVER_ROOM_NAME,
  playtestRegistry,
} from "@escaperoom/colyseus-server";
import { removeObject, roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  createCatalogService,
  createInMemoryPublishedRoomListing,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
} from "@escaperoom/shared/services";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readPlaytestToken } from "../src/lib/playtest-link";
import {
  PLAYTEST_EXPIRED_CLOSE_CODE,
  PLAYTEST_MESSAGES,
  PLAYTEST_ROOM_NAME,
  toPlaytestView,
  type PlaytestStateLike,
} from "../src/lib/playtest-net";
import { readReyAldricRoomPackageJson } from "../src/lib/room-preview-fixture";
import {
  createHttpPlaytestLauncher,
  DEV_PLAYTEST_SECRET,
  PLAYTEST_INTERNAL_PATH,
  PlaytestLaunchError,
  resolveColyseusHttpUrl,
  resolvePlaytestSecret,
  type CreatePlaytestInput,
  type PlaytestLauncher,
} from "../src/server/playtest-launcher";
import {
  createRoomPlaytestHandlers,
  type RoomPlaytestHandlerDeps,
  type RoomPlaytestResponse,
} from "../src/server/rest/room-playtest";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };
const reyAldric = parseRoomPackage(JSON.parse(readReyAldricRoomPackageJson()) as unknown);

/** Lanzador de test que recuerda qué paquetes recibió. */
function recordingLauncher(inner?: PlaytestLauncher) {
  const received: CreatePlaytestInput[] = [];
  const launcher: PlaytestLauncher = {
    async create(input) {
      received.push(structuredClone(input));
      if (inner) return inner.create(input);
      return {
        playtestId: "pt-1",
        token: "eyJ2IjoxfQ~firma",
        expiresAt: Date.UTC(2030, 0, 1),
        roomId: "r1",
      };
    },
  };
  return { launcher, received };
}

/**
 * Handler con store de drafts en memoria (el actor viaja en una cabecera de
 * test) y el borrador del Rey Aldric escrito en el doc Yjs por el editor.
 */
async function setup(deps: Partial<Pick<RoomPlaytestHandlerDeps, "serialize" | "launcher">> = {}) {
  const store = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
  const drafts = createRoomDraftService({ store });
  const actors: Record<string, Actor> = { autora: author, otro: intruder };
  const recording = recordingLauncher();
  const handlers = createRoomPlaytestHandlers({
    drafts,
    resolveActor: async (req) => actors[req.headers.get("x-test-user") ?? ""] ?? ANONYMOUS_ACTOR,
    serialize: "serialize" in deps ? deps.serialize! : roomDocToPackage,
    launcher: "launcher" in deps ? deps.launcher! : recording.launcher,
  });

  const doc = new Y.Doc();
  const push = async (fn: () => void) => {
    const before = Y.encodeStateVector(doc);
    fn();
    await drafts.appendUpdate(author, ROOM_ID, Y.encodeStateAsUpdate(doc, before));
  };
  await push(() => roomPackageToDoc(reyAldric, doc));

  const play = (user?: string, roomId = ROOM_ID) =>
    handlers.postPlaytest(
      new Request(`http://localhost/api/rooms/${roomId}/playtest`, {
        method: "POST",
        headers: user ? { "x-test-user": user } : {},
      }),
      { params: Promise.resolve({ roomId }) },
    );
  return { doc, push, play, received: recording.received };
}

describe("POST /api/rooms/:roomId/playtest (handler)", () => {
  it("201 con el link de prueba; el paquete se serializa en servidor desde el doc", async () => {
    const api = await setup();
    const res = await api.play("autora");
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = (await res.json()) as RoomPlaytestResponse;
    expect(json).toEqual({
      roomId: ROOM_ID,
      playtestId: "pt-1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      path: "/playtest/eyJ2IjoxfQ~firma",
    });
    expect(api.received).toHaveLength(1);
    expect(api.received[0]).toMatchObject({ authorId: "autora", draftRoomId: ROOM_ID });
    expect(api.received[0]!.roomPackage.objects.map((o) => o.id)).toEqual(
      reyAldric.objects.map((o) => o.id),
    );
  });

  it("solo el autor: sin sesión → 401; otro usuario → 403; sala inexistente → 404", async () => {
    const api = await setup();
    const anonymous = await api.play();
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    const other = await api.play("otro");
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect((await api.play("autora", "33333333-3333-4333-8333-333333333333")).status).toBe(404);
    expect(api.received).toHaveLength(0);
  });

  it("422 si el draft no forma un RoomPackage; 503 sin playtest configurado", async () => {
    const invalid = await setup({ serialize: () => ({ meta: {} }) });
    const res = await invalid.play("autora");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "INVALID_DRAFT" } });
    expect(invalid.received).toHaveLength(0);

    const disabled = await setup({ launcher: null });
    const off = await disabled.play("autora");
    expect(off.status).toBe(503);
    expect(await off.json()).toMatchObject({ error: { code: "PLAYTEST_DISABLED" } });
  });

  it("traduce los fallos del servidor de partidas (422 injugable, 502 caído)", async () => {
    const failing = (code: "UNPLAYABLE" | "UNAVAILABLE"): PlaytestLauncher => ({
      create: async () => {
        throw new PlaytestLaunchError(code, "falla");
      },
    });
    expect((await (await setup({ launcher: failing("UNPLAYABLE") })).play("autora")).status).toBe(
      422,
    );
    expect((await (await setup({ launcher: failing("UNAVAILABLE") })).play("autora")).status).toBe(
      502,
    );
  });

  it("no publica: el borrador sigue fuera del catálogo tras crear el playtest", async () => {
    const api = await setup();
    expect((await api.play("autora")).status).toBe(201);
    // El catálogo solo lista salas `published` con versión: el playtest no crea ninguna.
    const catalog = createCatalogService({
      rooms: { load: async () => reyAldric },
      listing: createInMemoryPublishedRoomListing([
        { roomId: ROOM_ID, status: "draft", versions: [] },
      ]),
    });
    const { items } = await catalog.listRooms(ANONYMOUS_ACTOR);
    expect(items.map((room) => room.id)).not.toContain(ROOM_ID);
  });
});

describe("configuración compartida con @escaperoom/colyseus-server", () => {
  it("mismo secreto de desarrollo, ruta interna, room y código de caducidad", () => {
    expect(DEV_PLAYTEST_SECRET).toBe(SERVER_DEV_SECRET);
    expect(PLAYTEST_INTERNAL_PATH).toBe(SERVER_INTERNAL_PATH);
    expect(PLAYTEST_ROOM_NAME).toBe(SERVER_ROOM_NAME);
    expect(PLAYTEST_EXPIRED_CLOSE_CODE).toBe(SERVER_EXPIRED_CODE);
  });

  it("resuelve URL y secreto del entorno", () => {
    expect(resolveColyseusHttpUrl({})).toBe("http://localhost:2567");
    expect(resolveColyseusHttpUrl({ NEXT_PUBLIC_COLYSEUS_URL: "wss://juego.example/" })).toBe(
      "https://juego.example",
    );
    expect(resolveColyseusHttpUrl({ COLYSEUS_INTERNAL_URL: "http://colyseus:2567" })).toBe(
      "http://colyseus:2567",
    );
    expect(resolvePlaytestSecret({ NODE_ENV: "production" })).toBeNull();
    expect(resolvePlaytestSecret({ NODE_ENV: "production", PLAYTEST_SECRET: "s" })).toBe("s");
    expect(resolvePlaytestSecret({})).toBe(DEV_PLAYTEST_SECRET);
  });
});

/** Puerto TCP libre del SO (como `colyseus-server/test/helpers/free-port`). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("sin puerto"));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

describe("playtest de punta a punta (web → Colyseus real)", () => {
  let server: ReturnType<typeof createGameServer>;
  let port: number;

  beforeAll(async () => {
    port = await freePort();
    server = createGameServer();
    await server.listen(port);
  });

  afterAll(async () => {
    playtestRegistry.clear();
    await server.gracefullyShutdown(false);
  });

  async function createAndJoin() {
    const inner = createHttpPlaytestLauncher({
      baseUrl: `http://localhost:${port}`,
      secret: DEV_PLAYTEST_SECRET,
    });
    const recording = recordingLauncher(inner);
    const api = await setup({ launcher: recording.launcher });
    const res = await api.play("autora");
    expect(res.status).toBe(201);
    const created = (await res.json()) as RoomPlaytestResponse;
    const token = decodeURIComponent(created.path.split("/").at(-1)!);
    const payload = readPlaytestToken(token)!;
    expect(payload.playtestId).toBe(created.playtestId);
    const client = new Client(`ws://localhost:${port}`);
    const join = () =>
      client.joinOrCreate<PlaytestStateLike>(PLAYTEST_ROOM_NAME, {
        playtestId: payload.playtestId,
        token,
      });
    return { api, created, join, token, received: recording.received, client };
  }

  it("el Rey Aldric del doc se juega en la room temporal; editar el draft no la cambia", async () => {
    const { api, join, received } = await createAndJoin();
    const room = await join();
    await expect
      .poll(() => room.state.roomPackageId)
      .toBe((received[0]!.roomPackage as RoomPackage).meta.id);

    const intro = new Promise((resolve) => room.onMessage(PLAYTEST_MESSAGES.dialogShow, resolve));
    room.send(PLAYTEST_MESSAGES.startGame, {});
    expect(await intro).toEqual({ dialogId: "d-intro" });
    await expect.poll(() => room.state.phase).toBe("playing");

    // El autor borra el cuadro del borrador con la partida en curso…
    await api.push(() => removeObject(api.doc, "cuadro-aurelio"));
    const second = await api.play("autora");
    expect(second.status).toBe(201);
    expect(received[1]!.roomPackage.objects.map((o) => o.id)).not.toContain("cuadro-aurelio");

    // …pero la partida ya creada juega con el paquete congelado.
    const granted = new Promise((resolve) =>
      room.onMessage(PLAYTEST_MESSAGES.itemGranted, resolve),
    );
    room.send(PLAYTEST_MESSAGES.interact, { objectId: "cuadro-aurelio" });
    expect(await granted).toEqual({ playerId: room.sessionId, itemId: "llave-bronce" });
    await expect
      .poll(() => toPlaytestView(room.state, room.sessionId).inventory)
      .toEqual(["llave-bronce"]);
    await room.leave();
  });

  it("un amigo entra con el link en la misma partida; un token manipulado no entra", async () => {
    const { join, client, created, token } = await createAndJoin();
    const host = await join();
    const friend = await join();
    expect(friend.roomId).toBe(host.roomId);
    await expect.poll(() => toPlaytestView(friend.state, friend.sessionId).players.length).toBe(2);

    const [body] = token.split("~");
    await expect(
      client.joinOrCreate(PLAYTEST_ROOM_NAME, {
        playtestId: created.playtestId,
        token: `${body}~firma-falsa`,
      }),
    ).rejects.toThrow();
    await friend.leave();
    await host.leave();
  });
});
