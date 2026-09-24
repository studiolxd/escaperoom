import { randomUUID } from "node:crypto";
import { createEditorSyncServer } from "@escaperoom/editor/sync-server";
import { getRedis, getSubscriberRedis } from "@escaperoom/kit/redis";
import { publishDraftUpdate, subscribeDraftUpdates } from "@escaperoom/kit/room-sync";
import {
  createInMemoryRoomDraftStore,
  createRoomDraftService,
  type Actor,
} from "@escaperoom/shared/services";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import * as Y from "yjs";
import { EditorSyncProvider } from "@escaperoom/editor";

// ---------------------------------------------------------------------------
// Integración contra Redis real (`pnpm infra:up`), como
// `packages/kit/test/integration.test.ts`. Se SALTA sin `REDIS_URL`; el
// suite por defecto ya cubre lo mismo con un bus en memoria
// (`packages/editor/test/sync-cross-process.test.ts`) que ejerce el MISMO
// código de `createEditorSyncServer`/`createRoomDraftService`. Este test
// añade la confianza de que el adaptador de Redis (canal, base64, JSON) de
// `@escaperoom/kit/room-sync` funciona de punta a punta entre DOS procesos
// `editor-sync` de verdad.
//
//   REDIS_URL=redis://:redis_dev_only@localhost:56380 pnpm --filter @escaperoom/web test
// ---------------------------------------------------------------------------

const hasRedis = Boolean(process.env.REDIS_URL);
const ROOM_ID = "33333333-3333-4333-8333-333333333333";
const author: Actor = { userId: "autora", organizationId: null, role: "member" };
const silent = { warn: () => undefined, error: () => undefined };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

describe.skipIf(!hasRedis)("editor-sync entre procesos, con Redis real", () => {
  afterAll(async () => {
    await getRedis()
      ?.quit()
      .catch(() => undefined);
    await getSubscriberRedis()
      ?.quit()
      .catch(() => undefined);
  });

  /** Un proceso `editor-sync`: su propio doc en memoria, su propio originId, el MISMO store "Postgres". */
  async function startProcess(store: ReturnType<typeof createInMemoryRoomDraftStore>) {
    const originId = randomUUID();
    const drafts = createRoomDraftService({
      store,
      snapshotEvery: 1000,
      publish: async (event) => {
        await publishDraftUpdate({ ...event, originId });
      },
    });
    const server = createEditorSyncServer({
      drafts,
      resolveActor: async () => author,
      pingIntervalMs: 0,
      logger: silent,
      remoteUpdates: { subscribe: subscribeDraftUpdates, originId },
    });
    const { port } = await server.listen(0, "127.0.0.1");
    cleanups.push(() => server.close());
    return { drafts, url: `ws://127.0.0.1:${port}` };
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

  async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > timeoutMs) throw new Error("waitFor: timeout");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("un cliente WS en el proceso A ve una escritura del proceso B sin recargar", async () => {
    const store = createInMemoryRoomDraftStore([{ id: ROOM_ID, authorId: author.userId }]);
    const a = await startProcess(store);
    const b = await startProcess(store);

    const client = connectClient(a.url);
    await client.whenSynced();

    const external = new Y.Doc();
    external.getMap("meta").set("title", "Escrito desde el proceso B por Redis");
    await b.drafts.appendUpdate(author, ROOM_ID, Y.encodeStateAsUpdate(external));

    await waitFor(
      () => client.doc.getMap("meta").get("title") === "Escrito desde el proceso B por Redis",
    );
    expect(client.doc.getMap("meta").toJSON()).toEqual({
      title: "Escrito desde el proceso B por Redis",
    });
  });
});
