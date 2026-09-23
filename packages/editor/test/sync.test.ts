import {
  ANONYMOUS_ACTOR,
  buildDraftDoc,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
  type RoomDraftService,
  type RoomDraftStore,
} from "@escaperoom/shared/services";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import * as Y from "yjs";
import { EditorSyncProvider, EditorSyncRestoreError } from "../src";
import { CLOSE_PERSISTENCE_FAILED, createEditorSyncServer } from "../src/sync/server";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const MISSING_ROOM_ID = "99999999-9999-4999-8999-999999999999";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const intruder: Actor = { userId: "otro", organizationId: null, role: "member" };
const ACTORS: Record<string, Actor> = { autora: author, otro: intruder };
const silent = { warn: () => undefined, error: () => undefined };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** Servidor de sincronización sobre un store en memoria; el actor viaja en `x-test-user`. */
async function startServer(
  store: RoomDraftStore,
  opts: { drafts?: RoomDraftService; allowedOrigins?: string[] } = {},
) {
  const drafts = opts.drafts ?? createRoomDraftService({ store, snapshotEvery: 1000 });
  const server = createEditorSyncServer({
    drafts,
    resolveActor: async (req) =>
      ACTORS[String(req.headers["x-test-user"] ?? "")] ?? ANONYMOUS_ACTOR,
    allowedOrigins: opts.allowedOrigins,
    pingIntervalMs: 0,
    logger: silent,
  });
  const { port } = await server.listen(0, "127.0.0.1");
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await server.close();
  };
  cleanups.push(close);
  return { server, drafts, url: `ws://127.0.0.1:${port}`, close };
}

function newStore() {
  return createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
}

function connectClient(url: string, user = "autora", doc = new Y.Doc(), roomId = ROOM_ID) {
  const provider = new EditorSyncProvider({
    url,
    roomId,
    doc,
    createWebSocket: (u) =>
      new WsWebSocket(u, { headers: { "x-test-user": user } }) as unknown as WebSocket,
    minReconnectDelayMs: 10,
    maxReconnectDelayMs: 50,
  });
  cleanups.push(() => provider.destroy());
  return provider;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function stateOf(doc: Y.Doc) {
  return {
    meta: doc.getMap("meta").toJSON(),
    tiles: doc.getArray("tiles").toJSON(),
    objects: doc.getMap("objects").toJSON(),
    notas: doc.getText("notas").toString(),
  };
}

async function persistedState(drafts: RoomDraftService) {
  const doc = buildDraftDoc(await drafts.loadDraft(author, ROOM_ID));
  try {
    return stateOf(doc);
  } finally {
    doc.destroy();
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

describe("WebSocket de edición: coedición y autosave", () => {
  it("dos clientes coeditan, convergen y cada cambio queda persistido sin guardar", async () => {
    const store = newStore();
    const { url, drafts } = await startServer(store);
    const a = connectClient(url);
    const b = connectClient(url);
    await Promise.all([a.whenSynced(), b.whenSynced()]);

    a.doc.transact(() => {
      a.doc.getMap("meta").set("title", "La bodega");
      a.doc.getArray<number>("tiles").push([1, 2, 3]);
    });
    b.doc.transact(() => {
      const obj = new Y.Map<unknown>();
      obj.set("x", 4);
      b.doc.getMap("objects").set("arca-trono", obj);
      b.doc.getArray<number>("tiles").push([9]);
    });
    b.doc.getText("notas").insert(0, "B;");
    a.doc.getText("notas").insert(0, "A;");

    await waitFor(
      () => same(stateOf(a.doc), stateOf(b.doc)) && a.doc.getArray("tiles").length === 4,
    );
    expect(stateOf(a.doc).meta).toEqual({ title: "La bodega" });
    expect(stateOf(a.doc).objects).toEqual({ "arca-trono": { x: 4 } });
    await waitFor(async () => same(await persistedState(drafts), stateOf(a.doc)));
    const updates = await store.updatesAfter(ROOM_ID, 0n);
    expect(updates.length).toBeGreaterThanOrEqual(4);
    expect(new Set(updates.map((u) => u.authorId))).toEqual(new Set([author.userId]));
  });

  it("un cliente offline edita, reconecta y ambos convergen sin perder cambios", async () => {
    const store = newStore();
    const { url, drafts } = await startServer(store);
    const a = connectClient(url);
    const b = connectClient(url);
    await Promise.all([a.whenSynced(), b.whenSynced()]);
    a.doc.getText("notas").insert(0, "base");
    await waitFor(() => b.doc.getText("notas").toString() === "base");

    b.disconnect();
    expect(b.status).toBe("disconnected");
    // Ediciones concurrentes: B sin conexión, A en línea.
    b.doc.getText("notas").insert(4, "-offlineB");
    b.doc.getMap("meta").set("offline", true);
    a.doc.getText("notas").insert(0, "onlineA-");
    a.doc.getArray<number>("tiles").push([7]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(b.doc.getArray("tiles").length).toBe(0);

    b.connect();
    await b.whenSynced();
    await waitFor(
      () => same(stateOf(a.doc), stateOf(b.doc)) && a.doc.getMap("meta").has("offline"),
    );
    expect(a.doc.getText("notas").toString()).toBe("onlineA-base-offlineB");
    expect(stateOf(b.doc).tiles).toEqual([7]);
    await waitFor(async () => same(await persistedState(drafts), stateOf(b.doc)));
  });

  it("la awareness de un cliente llega al otro, desaparece al irse y no se persiste", async () => {
    const store = newStore();
    const { url } = await startServer(store);
    const a = connectClient(url);
    const b = connectClient(url);
    await Promise.all([a.whenSynced(), b.whenSynced()]);

    a.awareness.setLocalStateField("user", { name: "María", editing: "puzzle-brasero" });
    await waitFor(() => b.awareness.getStates().get(a.doc.clientID)?.user?.name === "María");
    expect(b.awareness.getStates().get(a.doc.clientID)?.user).toEqual({
      name: "María",
      editing: "puzzle-brasero",
    });

    // Un tercero que entra después recibe el estado actual.
    const c = connectClient(url);
    await waitFor(() => c.awareness.getStates().get(a.doc.clientID)?.user?.name === "María");

    a.disconnect();
    await waitFor(() => !b.awareness.getStates().has(a.doc.clientID));
    expect(await store.countUpdatesAfter(ROOM_ID, 0n)).toBe(0);
  });
});

describe("WebSocket de edición: persistencia", () => {
  it("tras reiniciar el servidor el doc se reconstruye desde persistencia", async () => {
    const store = newStore();
    const first = await startServer(store);
    const a = connectClient(first.url);
    await a.whenSynced();
    a.doc.transact(() => {
      a.doc.getMap("meta").set("title", "Sala del rey");
      a.doc.getArray<number>("tiles").push([1, 1, 2]);
    });
    a.doc.getText("notas").insert(0, "hola");
    const expected = stateOf(a.doc);
    await waitFor(async () => same(await persistedState(first.drafts), expected));
    a.destroy();
    await first.close();

    const second = await startServer(store);
    expect(second.server.loadedRooms()).toEqual([]);
    const fresh = connectClient(second.url);
    await fresh.whenSynced();
    expect(stateOf(fresh.doc)).toEqual(expected);
  });

  it("al irse el último editor libera la sala y compacta un snapshot", async () => {
    const store = newStore();
    const { url, server, drafts } = await startServer(store);
    const a = connectClient(url);
    await a.whenSynced();
    a.doc.getMap("meta").set("title", "x");
    expect(server.loadedRooms()).toEqual([ROOM_ID]);
    a.disconnect();
    await waitFor(() => server.loadedRooms().length === 0);
    await waitFor(async () => (await drafts.listHistory(author, ROOM_ID)).length === 1);
  });

  it("si falla la persistencia, cierra la sala y al reconectar se persiste lo pendiente", async () => {
    const store = newStore();
    const real = createRoomDraftService({ store, snapshotEvery: 1000 });
    let failures = 1;
    const drafts: RoomDraftService = {
      ...real,
      async appendUpdate(...args) {
        if (failures-- > 0) throw new Error("postgres caído");
        return real.appendUpdate(...args);
      },
    };
    const { url } = await startServer(store, { drafts });
    const a = connectClient(url);
    await a.whenSynced();
    const closes: number[] = [];
    a.on("connection-close", ({ code }) => closes.push(code));

    a.doc.getMap("meta").set("title", "no se pierde");
    await waitFor(() => closes.includes(CLOSE_PERSISTENCE_FAILED));
    await waitFor(async () => (await persistedState(real)).meta.title === "no se pierde");
  });
});

describe("WebSocket de edición: restauración del historial", () => {
  it("restaura a un punto anterior en vivo, llega a todos y conserva la historia", async () => {
    const store = newStore();
    const { url, drafts } = await startServer(store);
    const a = connectClient(url);
    const b = connectClient(url);
    await Promise.all([a.whenSynced(), b.whenSynced()]);

    a.doc.transact(() => {
      a.doc.getMap("meta").set("title", "Versión de ayer");
      a.doc.getArray<number>("tiles").push([1, 2]);
    });
    const expected = stateOf(a.doc);
    await waitFor(async () => same(await persistedState(drafts), expected));
    const checkpoint = (await store.updatesAfter(ROOM_ID, 0n)).at(-1)!.id;
    // Que el servidor haya persistido no implica que B lo haya recibido: el
    // broadcast viaja por otro socket. Sin esto, B borra de un array vacío.
    await waitFor(() => same(stateOf(b.doc), expected));

    b.doc.transact(() => {
      b.doc.getMap("meta").set("title", "Versión de hoy");
      b.doc.getArray<number>("tiles").delete(0, 1);
      b.doc.getText("notas").insert(0, "cambios");
    });
    const today = stateOf(b.doc);
    await waitFor(async () => same(await persistedState(drafts), today));
    // A debe ver lo de B antes de restaurar; si no, "A == expected" se cumpliría sin restaurar nada.
    await waitFor(() => same(stateOf(a.doc), today));
    const history = await store.updatesAfter(ROOM_ID, 0n);

    await expect(a.restore({ updateId: checkpoint.toString() })).resolves.toEqual({
      changed: true,
    });
    await waitFor(() => same(stateOf(a.doc), expected) && same(stateOf(b.doc), expected));
    await waitFor(async () => same(await persistedState(drafts), expected));

    const after = await store.updatesAfter(ROOM_ID, 0n);
    expect(after).toHaveLength(history.length + 1);
    expect(after.slice(0, history.length).map((u) => u.id)).toEqual(history.map((u) => u.id));

    // Restaurar de nuevo al mismo punto deja el mismo contenido; un punto inexistente falla.
    await a.restore({ updateId: checkpoint.toString() });
    await waitFor(async () => same(await persistedState(drafts), expected));
    expect(stateOf(b.doc)).toEqual(expected);
    const error = await a.restore({ updateId: "999999" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(EditorSyncRestoreError);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("server.restore() funciona también sin editores conectados", async () => {
    const store = newStore();
    const { url, server, drafts } = await startServer(store);
    const a = connectClient(url);
    await a.whenSynced();
    a.doc.getMap("meta").set("title", "uno");
    await waitFor(async () => (await store.countUpdatesAfter(ROOM_ID, 0n)) === 1);
    a.doc.getMap("meta").set("title", "dos");
    a.disconnect();
    await waitFor(() => server.loadedRooms().length === 0);

    await expect(server.restore(author, ROOM_ID, { updateId: 1n })).resolves.toEqual({
      changed: true,
    });
    expect((await persistedState(drafts)).meta).toEqual({ title: "uno" });
    await expect(server.restore(intruder, ROOM_ID, { updateId: 1n })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("WebSocket de edición: auth en el handshake", () => {
  /** Abre un WebSocket crudo y devuelve el status HTTP del rechazo (o 101 si acepta). */
  function handshakeStatus(url: string, headers: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = new WsWebSocket(url, { headers });
      socket.on("open", () => {
        socket.close();
        resolve(101);
      });
      socket.on("unexpected-response", (_req, res) => {
        resolve(res.statusCode ?? 0);
        socket.terminate();
      });
      socket.on("error", (err) => {
        if (!String(err.message).includes("Unexpected server response")) reject(err);
      });
    });
  }

  it("rechaza sin permiso (403), sin sesión (401), sala inexistente (404) y origen no permitido", async () => {
    const store = newStore();
    const { url } = await startServer(store, { allowedOrigins: ["https://editor.test"] });
    const room = `${url}/rooms/${ROOM_ID}`;

    expect(await handshakeStatus(room, { "x-test-user": "otro" })).toBe(403);
    expect(await handshakeStatus(room, {})).toBe(401);
    expect(
      await handshakeStatus(`${url}/rooms/${MISSING_ROOM_ID}`, { "x-test-user": "autora" }),
    ).toBe(404);
    expect(await handshakeStatus(`${url}/otra-ruta`, { "x-test-user": "autora" })).toBe(404);
    expect(
      await handshakeStatus(room, { "x-test-user": "autora", origin: "https://malicioso.test" }),
    ).toBe(403);
    expect(
      await handshakeStatus(room, { "x-test-user": "autora", origin: "https://editor.test" }),
    ).toBe(101);
  });

  it("un proveedor sin permiso nunca sincroniza ni carga la sala", async () => {
    const store = newStore();
    const { url, server } = await startServer(store);
    const intruderProvider = connectClient(url, "otro");
    let closes = 0;
    intruderProvider.on("connection-close", () => closes++);
    await waitFor(() => closes >= 2);
    expect(intruderProvider.synced).toBe(false);
    expect(server.loadedRooms()).toEqual([]);
  });
});

describe("applyUpdate (updates de fuera de la sesión: MCP, 4.2)", () => {
  function remoteUpdate(key: string): Uint8Array {
    const doc = new Y.Doc();
    doc.getMap("meta").set(key, true);
    return Y.encodeStateAsUpdate(doc);
  }

  it("con sesión viva lo difunde a los editores y lo persiste; sin ella, solo lo persiste", async () => {
    const store = newStore();
    const { server, drafts, url } = await startServer(store);

    await server.applyUpdate(author, ROOM_ID, remoteUpdate("sinSesion"));
    expect(server.loadedRooms()).toEqual([]);

    const doc = new Y.Doc();
    connectClient(url, "autora", doc);
    await waitFor(() => doc.getMap("meta").get("sinSesion") === true);

    await server.applyUpdate(author, ROOM_ID, remoteUpdate("conSesion"));
    await waitFor(() => doc.getMap("meta").get("conSesion") === true);
    const persisted = buildDraftDoc(await drafts.loadDraft(author, ROOM_ID));
    expect(persisted.getMap("meta").toJSON()).toEqual({ sinSesion: true, conSesion: true });
  });

  it("aplica la misma autorización que el handshake", async () => {
    const { server } = await startServer(newStore());
    await expect(server.applyUpdate(intruder, ROOM_ID, remoteUpdate("x"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
