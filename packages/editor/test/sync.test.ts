import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  buildDraftDoc,
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
  type RoomDraftService,
  type RoomDraftStore,
} from "@escaperoom/shared/services";
import * as encoding from "lib0/encoding";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  EditorSyncProvider,
  EditorSyncRestoreError,
  EditToolController,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  roomPackageToDoc,
  STROKE_FLUSH_INTERVAL_MS,
  SYNC_PATH_PREFIX,
} from "../src";
import {
  CLOSE_PERSISTENCE_FAILED,
  createEditorSyncServer,
  DEFAULT_MAX_AWARENESS_MESSAGES_PER_SECOND,
  DEFAULT_MAX_MESSAGES_PER_SECOND,
  DEFAULT_MAX_SYNC_STEP1_PER_MINUTE,
  type EditorSyncServerOptions,
} from "../src/sync/server";

/** Mismo fixture que `room-doc.test.ts`: trae la sub-sala "bodega" (18×12) para pintar de verdad. */
const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const fixture: RoomPackage = parseRoomPackage(
  JSON.parse(readFileSync(fixturePath, "utf8")) as unknown,
);

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
  opts: { drafts?: RoomDraftService } & Partial<
    Omit<EditorSyncServerOptions, "drafts" | "resolveActor" | "logger">
  > = {},
) {
  const { drafts: draftsOverride, ...serverOpts } = opts;
  const drafts = draftsOverride ?? createRoomDraftService({ store, snapshotEvery: 1000 });
  const server = createEditorSyncServer({
    drafts,
    resolveActor: async (req) =>
      ACTORS[String(req.headers["x-test-user"] ?? "")] ?? ANONYMOUS_ACTOR,
    pingIntervalMs: 0,
    logger: silent,
    ...serverOpts,
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

  it("C-21: una conexión no puede suplantar la awareness (clientID) de otra", async () => {
    const store = newStore();
    const { url } = await startServer(store);
    const a = connectClient(url);
    const b = connectClient(url);
    await Promise.all([a.whenSynced(), b.whenSynced()]);

    b.awareness.setLocalStateField("user", { name: "Bruno" });
    await waitFor(() => a.awareness.getStates().get(b.doc.clientID)?.user?.name === "Bruno");

    // Conexión ajena (misma autora, otra pestaña — el modelo de datos aún no
    // tiene coeditores) que intenta suplantar el `clientID` de B con un
    // mensaje de awareness crudo, saltándose el cliente `y-protocols`.
    const raw = new WsWebSocket(`${url}${SYNC_PATH_PREFIX}${encodeURIComponent(ROOM_ID)}`, {
      headers: { "x-test-user": "autora" },
    });
    cleanups.push(() => raw.close());
    await new Promise<void>((resolve) => raw.once("open", () => resolve()));

    const inner = encoding.createEncoder();
    encoding.writeVarUint(inner, 1);
    encoding.writeVarUint(inner, b.doc.clientID);
    encoding.writeVarUint(inner, 999999); // clock alto: ganaría si se aplicara
    encoding.writeVarString(inner, JSON.stringify({ user: { name: "Suplantado" } }));
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, encoding.toUint8Array(inner));
    raw.send(encoding.toUint8Array(encoder));

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(a.awareness.getStates().get(b.doc.clientID)?.user).toEqual({ name: "Bruno" });
    expect(b.awareness.getStates().get(b.doc.clientID)?.user).toEqual({ name: "Bruno" });
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

  it("C-21: una edición concurrente durante la restauración no se pierde ni corrompe el doc", async () => {
    const store = newStore();
    const real = createRoomDraftService({ store, snapshotEvery: 1000 });
    let gateOpen = false;
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    // Simula la ventana que antes ocupaba el viaje a BD para leer el estado
    // "actual": retrasa la resolución del plan hasta después de que la
    // edición concurrente de abajo ya haya llegado al doc vivo del servidor.
    const drafts: RoomDraftService = {
      ...real,
      async planRestoreAgainstDoc(...args) {
        gateOpen = true;
        await gate;
        return real.planRestoreAgainstDoc(...args);
      },
    };
    const { url } = await startServer(store, { drafts });
    const a = connectClient(url);
    const b = connectClient(url);
    await Promise.all([a.whenSynced(), b.whenSynced()]);

    a.doc.getMap("meta").set("title", "v1");
    await waitFor(() => same(stateOf(a.doc), stateOf(b.doc)) && stateOf(a.doc).meta.title === "v1");

    // Restaura al doc vacío inicial (updateId 0) mientras el plan está retenido.
    const restorePromise = a.restore({ updateId: "0" });
    await waitFor(() => gateOpen);
    // Edición concurrente de B, aplicada al doc vivo del servidor MIENTRAS el
    // plan sigue pendiente (todavía no se ha leído el estado "actual").
    b.doc.getMap("objects").set("concurrente", new Y.Map());
    await waitFor(() => a.doc.getMap("objects").has("concurrente"));
    releaseGate!();

    // Con el bug (el plan se calculaba sobre una foto de BD tomada ANTES de
    // esta edición) el update de restauración no sabría nada de
    // "concurrente" y lo dejaría huérfano tras "restaurar" — resultado
    // inconsistente entre lo que la restauración dice haber hecho y el doc
    // real. Con el fix, el plan lee `room.doc` (que ya incluye la edición
    // concurrente) en el mismo tick en que se calcula, así que el diff SÍ la
    // deshace junto con el resto y el doc queda realmente vacío en ambos
    // clientes.
    await expect(restorePromise).resolves.toEqual({ changed: true });
    await waitFor(() => same(stateOf(a.doc), stateOf(b.doc)) && stateOf(a.doc).meta.title === undefined);
    expect(stateOf(a.doc)).toEqual({ meta: {}, tiles: [], objects: {}, notas: "" });
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

  it("C-10: sin lista, con strictOriginWithoutAllowlist falla cerrado salvo mismo Host; con cookie exige Origin", async () => {
    const store = newStore();
    const { url } = await startServer(store, { strictOriginWithoutAllowlist: true });
    const room = `${url}/rooms/${ROOM_ID}`;
    const port = new URL(url).port;

    // Sin Origin ni cookie (cliente no-navegador, p. ej. Bearer): se acepta.
    expect(await handshakeStatus(room, { "x-test-user": "autora" })).toBe(101);
    // Origin presente mientras no haya lista: solo se acepta si coincide con el Host.
    expect(
      await handshakeStatus(room, { "x-test-user": "autora", origin: "http://otro-host.test" }),
    ).toBe(403);
    expect(
      await handshakeStatus(room, {
        "x-test-user": "autora",
        origin: `http://127.0.0.1:${port}`,
      }),
    ).toBe(101);
    // Con cookie (identidad de sesión), el Origin es obligatorio aunque no haya lista.
    expect(
      await handshakeStatus(room, { "x-test-user": "autora", cookie: "session=cualquiera" }),
    ).toBe(403);
  });

  it("C-10: sin strictOriginWithoutAllowlist ni lista, mantiene el comportamiento permisivo (dev)", async () => {
    const store = newStore();
    const { url } = await startServer(store);
    const room = `${url}/rooms/${ROOM_ID}`;
    expect(
      await handshakeStatus(room, { "x-test-user": "autora", origin: "https://cualquiera.test" }),
    ).toBe(101);
  });

  it("C-11: tope de conexiones por usuario en la sala responde 429", async () => {
    const store = newStore();
    const { url } = await startServer(store, { maxConnectionsPerUser: 2 });
    const room = `${url}/rooms/${ROOM_ID}`;
    const sockets = [new WsWebSocket(room, { headers: { "x-test-user": "autora" } })];
    await new Promise<void>((resolve) => sockets[0]!.once("open", () => resolve()));
    sockets.push(new WsWebSocket(room, { headers: { "x-test-user": "autora" } }));
    await new Promise<void>((resolve) => sockets[1]!.once("open", () => resolve()));
    cleanups.push(() => sockets.forEach((s) => s.close()));

    expect(await handshakeStatus(room, { "x-test-user": "autora" })).toBe(429);
    // Otro usuario no comparte el cupo.
    expect(await handshakeStatus(room, { "x-test-user": "otro" })).toBe(403); // FORBIDDEN: no es su sala
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

  it("C-12: con sesión viva, rechaza un update inválido o demasiado grande sin tirar la sala", async () => {
    const store = newStore();
    const { server, url } = await startServer(store, { maxUpdateBytes: 200 });
    const a = connectClient(url);
    await a.whenSynced();

    const bigDoc = new Y.Doc();
    bigDoc.getText("notas").insert(0, "z".repeat(1000));
    const bigUpdate = Y.encodeStateAsUpdate(bigDoc);
    expect(bigUpdate.byteLength).toBeGreaterThan(200);

    await expect(server.applyUpdate(author, ROOM_ID, bigUpdate)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    await expect(
      server.applyUpdate(author, ROOM_ID, new Uint8Array([1, 2, 3])),
    ).rejects.toMatchObject({ code: "INVALID_UPDATE" });
    expect(server.loadedRooms()).toEqual([ROOM_ID]);
    expect(a.doc.getText("notas").toString()).toBe("");
  });
});

describe("WebSocket de edición: límites de tamaño y cadencia (C-11/C-12)", () => {
  it("C-12: un update entre maxUpdateBytes y maxMessageBytes se rechaza sin tirar la sala ni difundirse", async () => {
    const store = newStore();
    const { url, drafts } = await startServer(store, {
      maxUpdateBytes: 200,
      maxMessageBytes: 10_000,
    });
    const a = connectClient(url);
    await a.whenSynced();

    const raw = new WsWebSocket(`${url}${SYNC_PATH_PREFIX}${encodeURIComponent(ROOM_ID)}`, {
      headers: { "x-test-user": "autora" },
    });
    cleanups.push(() => raw.close());
    await new Promise<void>((resolve) => raw.once("open", () => resolve()));
    const closes: number[] = [];
    raw.on("close", (code) => closes.push(code));

    const bigDoc = new Y.Doc();
    bigDoc.getText("notas").insert(0, "x".repeat(2000));
    const bigUpdate = Y.encodeStateAsUpdate(bigDoc);
    expect(bigUpdate.byteLength).toBeGreaterThan(200);
    expect(bigUpdate.byteLength).toBeLessThan(10_000);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, bigUpdate);
    raw.send(encoding.toUint8Array(encoder));

    await waitFor(() => closes.length > 0);
    expect(closes[0]).toBe(1009);

    // Ni se difundió a A ni se persistió; la sala sigue viva.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(a.doc.getText("notas").toString()).toBe("");
    a.doc.getText("notas").insert(0, "sigue vivo");
    await waitFor(async () => (await persistedState(drafts)).notas === "sigue vivo");
  });

  it("C-11: al alcanzar el tope de bytes del doc, cierra solo ese socket sin persistir el update", async () => {
    const store = newStore();
    const { url, drafts } = await startServer(store, { maxDocBytes: 300 });
    const a = connectClient(url);
    await a.whenSynced();
    const closes: number[] = [];
    a.on("connection-close", ({ code }) => closes.push(code));

    a.doc.getText("notas").insert(0, "y".repeat(2000));
    await waitFor(() => closes.length > 0);
    expect(closes[0]).toBe(1008);
    expect((await persistedState(drafts)).notas).toBe("");
  });

  it("C-11: la cadencia de mensajes/s cierra el socket que la supera", async () => {
    const store = newStore();
    const { url } = await startServer(store, { maxMessagesPerSecond: 3 });
    const room = `${url}${SYNC_PATH_PREFIX}${encodeURIComponent(ROOM_ID)}`;
    const raw = new WsWebSocket(room, { headers: { "x-test-user": "autora" } });
    cleanups.push(() => raw.close());
    await new Promise<void>((resolve) => raw.once("open", () => resolve()));
    const closes: number[] = [];
    raw.on("close", (code) => closes.push(code));

    const queryEncoder = encoding.createEncoder();
    encoding.writeVarUint(queryEncoder, MESSAGE_QUERY_AWARENESS);
    const frame = encoding.toUint8Array(queryEncoder);
    for (let i = 0; i < 10; i++) raw.send(frame);

    await waitFor(() => closes.length > 0);
    expect(closes[0]).toBe(1008);
  });

  it("C-11: la cadencia de syncStep1/min cierra el socket que la supera", async () => {
    const store = newStore();
    const { url } = await startServer(store, { maxSyncStep1PerMinute: 2 });
    const room = `${url}${SYNC_PATH_PREFIX}${encodeURIComponent(ROOM_ID)}`;
    const raw = new WsWebSocket(room, { headers: { "x-test-user": "autora" } });
    cleanups.push(() => raw.close());
    await new Promise<void>((resolve) => raw.once("open", () => resolve()));
    const closes: number[] = [];
    raw.on("close", (code) => closes.push(code));

    const doc = new Y.Doc();
    const frame = () => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      return encoding.toUint8Array(encoder);
    };
    for (let i = 0; i < 5; i++) raw.send(frame());

    await waitFor(() => closes.length > 0);
    expect(closes[0]).toBe(1008);
  });

  it("C-11: DEFAULT_MAX_MESSAGES_PER_SECOND deja al menos ×3 de margen sobre el pico real del pincel", () => {
    // El pico real de un editor legítimo no es un número inventado: es el
    // propio throttle del cliente (`STROKE_FLUSH_INTERVAL_MS`, auditoría
    // D-17) el que decide cuántas transacciones Yjs por segundo puede
    // producir una pincelada continua. Si algún día se acelera ese throttle
    // sin revisar el límite del servidor, este test avisa.
    const realPeakPerSecond = 1000 / STROKE_FLUSH_INTERVAL_MS;
    expect(DEFAULT_MAX_MESSAGES_PER_SECOND).toBeGreaterThanOrEqual(realPeakPerSecond * 3);
  });

  it("C-11: un trazo de pincel realista + awareness a 20 Hz no provoca ningún cierre (defaults reales)", async () => {
    const store = newStore();
    const seed = roomPackageToDoc(fixture);
    await store.insertSnapshot(ROOM_ID, Y.encodeStateAsUpdate(seed), 0n);
    seed.destroy();

    // Sin overrides: reproduce exactamente los límites que corren en producción.
    const { url } = await startServer(store);
    const doc = new Y.Doc();
    const a = connectClient(url, "autora", doc);
    await a.whenSynced();
    const closes: number[] = [];
    a.on("connection-close", ({ code }) => closes.push(code));

    // Presencia simulada (todavía no hay UI de cursor compartido, pero C-11
    // reserva cupo aparte para cuando la haya): 20 Hz es un ritmo habitual de
    // throttle de cursor en editores colaborativos.
    const awarenessTimer = setInterval(() => {
      a.awareness.setLocalStateField("cursor", { x: Math.random() * 100, y: Math.random() * 100 });
    }, 50);

    const tools = new EditToolController(doc, { roomId: "bodega" });
    tools.selectTile(3, "ground");
    let x = 1;
    const y = 1;
    tools.pointer({ phase: "down", cell: { x, y } });
    const durationMs = 1500;
    const start = Date.now();
    // ~200 Hz de eventos de puntero — mucho más rápido que cualquier ratón
    // real — para comprobar que es el throttle interno del cliente
    // (`STROKE_FLUSH_INTERVAL_MS`), no la cadencia de esta simulación, quien
    // gobierna cuántos mensajes WS salen de verdad.
    while (Date.now() - start < durationMs) {
      x = 1 + (x % 16); // recorre la fila dentro de la rejilla 18×12 de "bodega"
      tools.pointer({ phase: "move", cell: { x, y } });
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    tools.pointer({ phase: "up", cell: { x, y } });
    clearInterval(awarenessTimer);

    expect(closes).toEqual([]);
    expect(a.status).toBe("connected");
  }, 5000);

  it("C-11: varias reconexiones tras un corte de red no agotan el cupo de syncStep1/min (defaults reales)", async () => {
    const store = newStore();
    const { url } = await startServer(store);
    const a = connectClient(url);
    await a.whenSynced();

    // 8 reconexiones en rápida sucesión: bastante más de lo que produce un
    // corte de red normal (backoff 100 ms → 10 s) y aun así muy por debajo
    // de DEFAULT_MAX_SYNC_STEP1_PER_MINUTE.
    expect(8).toBeLessThan(DEFAULT_MAX_SYNC_STEP1_PER_MINUTE);
    for (let i = 0; i < 8; i++) {
      a.disconnect();
      a.connect();
      await a.whenSynced();
    }
    expect(a.status).toBe("connected");
  });

  it("C-11: un flood muy por encima del pico real sigue cerrando el socket (defaults reales)", async () => {
    const store = newStore();
    const { url } = await startServer(store);
    const room = `${url}${SYNC_PATH_PREFIX}${encodeURIComponent(ROOM_ID)}`;
    const raw = new WsWebSocket(room, { headers: { "x-test-user": "autora" } });
    cleanups.push(() => raw.close());
    await new Promise<void>((resolve) => raw.once("open", () => resolve()));
    const closes: number[] = [];
    raw.on("close", (code) => closes.push(code));

    const queryEncoder = encoding.createEncoder();
    encoding.writeVarUint(queryEncoder, MESSAGE_QUERY_AWARENESS);
    const frame = encoding.toUint8Array(queryEncoder);
    // Muy por encima de DEFAULT_MAX_MESSAGES_PER_SECOND: un cliente que se
    // salta cualquier throttle, no una pincelada real.
    for (let i = 0; i < 10 * DEFAULT_MAX_MESSAGES_PER_SECOND; i++) raw.send(frame);

    await waitFor(() => closes.length > 0);
    expect(closes[0]).toBe(1008);
  });

  it("C-11: un flood de awareness muy por encima del pico razonable cierra el socket sin tocar el cubo genérico", async () => {
    const store = newStore();
    const { url } = await startServer(store);
    const room = `${url}${SYNC_PATH_PREFIX}${encodeURIComponent(ROOM_ID)}`;
    const raw = new WsWebSocket(room, { headers: { "x-test-user": "autora" } });
    cleanups.push(() => raw.close());
    await new Promise<void>((resolve) => raw.once("open", () => resolve()));
    const closes: number[] = [];
    raw.on("close", (code) => closes.push(code));

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, new Uint8Array([0])); // update vacío (0 entradas): válido y barato
    const frame = encoding.toUint8Array(encoder);
    for (let i = 0; i < 10 * DEFAULT_MAX_AWARENESS_MESSAGES_PER_SECOND; i++) raw.send(frame);

    await waitFor(() => closes.length > 0);
    expect(closes[0]).toBe(1008);
  });
});
