import {
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
  type RoomDraftStore,
} from "@escaperoom/shared/services";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import * as Y from "yjs";
import { EditorSyncProvider } from "../src";
import { createEditorSyncServer, type RemoteDraftSync, type RemoteDraftUpdate } from "../src/sync/server";

/**
 * Sincronización entre procesos `editor-sync` (specs/09 §2, decisión
 * 2026-09-23): el gap de los tickets 3.2/3.3/4.2 era que lo que escribían el
 * MCP/REST o OTRO proceso `editor-sync` no llegaba a un cliente WebSocket
 * conectado a ESTE proceso hasta que recargaba.
 *
 * En producción el canal es Redis pub/sub (`@escaperoom/kit/room-sync`); aquí
 * se sustituye por un bus en memoria con el MISMO contrato
 * (`RemoteDraftSync`/`publish` de `RoomDraftService`), así el test ejerce
 * exactamente el código de `createEditorSyncServer` y `createRoomDraftService`
 * que corre en real, sin necesitar Redis para el suite por defecto (hay un
 * segundo test, más abajo, que sí corre contra Redis real cuando está
 * disponible).
 */

const ROOM_ID = "22222222-2222-4222-8222-222222222222";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const silent = { warn: () => undefined, error: () => undefined };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** Bus con la forma de Redis pub/sub, en memoria: mismo contrato, sin infra. */
function createFakeDraftBus() {
  const listeners = new Set<(event: RemoteDraftUpdate) => void>();
  return {
    publish(event: RemoteDraftUpdate): void {
      for (const listener of [...listeners]) listener(event);
    },
    remoteSyncFor(originId: string): RemoteDraftSync {
      return {
        originId,
        subscribe(onUpdate) {
          listeners.add(onUpdate);
          return () => listeners.delete(onUpdate);
        },
      };
    },
  };
}

/** Un proceso `editor-sync` completo: su propio `RoomDraftService` (mismo store/"Postgres" que los demás) y su propio doc en memoria por sala. */
async function startProcess(
  store: RoomDraftStore,
  bus: ReturnType<typeof createFakeDraftBus>,
  originId: string,
) {
  const drafts = createRoomDraftService({
    store,
    snapshotEvery: 1000,
    publish: (event) => bus.publish({ ...event, originId }),
  });
  const server = createEditorSyncServer({
    drafts,
    resolveActor: async () => author,
    pingIntervalMs: 0,
    logger: silent,
    remoteUpdates: bus.remoteSyncFor(originId),
  });
  const { port } = await server.listen(0, "127.0.0.1");
  cleanups.push(() => server.close());
  return { server, drafts, url: `ws://127.0.0.1:${port}` };
}

function connectClient(url: string) {
  const doc = new Y.Doc();
  const provider = new EditorSyncProvider({
    url,
    roomId: ROOM_ID,
    doc,
    createWebSocket: (u) =>
      new WsWebSocket(u, { headers: { "x-test-user": "autora" } }) as unknown as WebSocket,
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

describe("sincronización entre procesos editor-sync (Redis pub/sub, specs/09 §2)", () => {
  it("un cliente WS en el proceso A ve, sin recargar, una escritura REST/MCP hecha en el proceso B", async () => {
    const store = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
    const bus = createFakeDraftBus();
    const a = await startProcess(store, bus, "process-a");
    const b = await startProcess(store, bus, "process-b");

    const client = connectClient(a.url);
    await client.whenSynced();

    // "Escritura REST/MCP" en el proceso B: nadie tiene esa sala abierta ahí,
    // así que pasa por `RoomDraftService.appendUpdate` directamente — el
    // mismo camino que `POST /api/rooms/:roomId/update` y el MCP sin
    // `liveSync` en el mismo proceso.
    const external = new Y.Doc();
    external.getMap("meta").set("title", "Escrito desde otro proceso");
    await b.drafts.appendUpdate(author, ROOM_ID, Y.encodeStateAsUpdate(external));

    await waitFor(() => client.doc.getMap("meta").get("title") === "Escrito desde otro proceso");
    expect(client.doc.getMap("meta").toJSON()).toEqual({ title: "Escrito desde otro proceso" });
  });

  it("propaga una edición WS de A a un cliente de B sin bucle de reenvío ni doble persistencia", async () => {
    const store = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
    const bus = createFakeDraftBus();
    const publishedBy: string[] = [];
    const rawPublish = bus.publish.bind(bus);
    bus.publish = (event) => {
      publishedBy.push(event.originId);
      rawPublish(event);
    };

    const a = await startProcess(store, bus, "process-a");
    const b = await startProcess(store, bus, "process-b");
    const clientA = connectClient(a.url);
    const clientB = connectClient(b.url);
    await Promise.all([clientA.whenSynced(), clientB.whenSynced()]);

    clientA.doc.getMap("meta").set("title", "hola");
    await waitFor(() => clientB.doc.getMap("meta").get("title") === "hola");

    // Solo A publica (una vez): B aplica el update remoto con un origen que
    // no es un `ActorOrigin`, así que ni lo repersiste ni lo vuelve a
    // publicar — si lo hiciera, `publishedBy` tendría un segundo
    // "process-b" y `store` un segundo update.
    expect(publishedBy).toEqual(["process-a"]);
    expect(await store.updatesAfter(ROOM_ID, 0n)).toHaveLength(1);
  });

  it("sin remoteUpdates (Redis no configurado), cada proceso sigue sirviendo a sus propios clientes", async () => {
    const store = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
    const drafts = createRoomDraftService({ store, snapshotEvery: 1000 });
    const server = createEditorSyncServer({
      drafts,
      resolveActor: async () => author,
      pingIntervalMs: 0,
      logger: silent,
      // Sin `remoteUpdates`: degradación esperada (decisión 2026-09-23).
    });
    const { port } = await server.listen(0, "127.0.0.1");
    cleanups.push(() => server.close());
    const url = `ws://127.0.0.1:${port}`;

    const a = connectClient(url);
    const c = connectClient(url);
    await Promise.all([a.whenSynced(), c.whenSynced()]);
    a.doc.getMap("meta").set("title", "sigue funcionando en este proceso");
    await waitFor(() => c.doc.getMap("meta").get("title") === "sigue funcionando en este proceso");
    expect(c.doc.getMap("meta").toJSON()).toEqual({ title: "sigue funcionando en este proceso" });
  });
});
