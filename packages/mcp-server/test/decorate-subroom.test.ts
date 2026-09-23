import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import { parseRoomPackage, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  buildDraftDoc,
  createCatalogService,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createRoomDraftService,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CREATOR_TOOLSET,
  createCreatorMcpServer,
  DraftSnapshotCache,
  type CreatorMcpDeps,
} from "../src";
import { call, errorCode } from "./fixtures/client";
import { ALDRIC_ROOM_ID, AUTHOR, loadAldric } from "./fixtures/drafts";

/**
 * `decorate_subroom`: la decoración y la iluminación de las habitaciones por
 * MCP, con los mismos comandos de `room-doc` que el editor (`setDecorations`,
 * `setLighting`) y el pipeline común de mutación (dry-run, errores
 * accionables, validador incremental).
 */

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const aldric = parseRoomPackage(loadAldric());
const roomId = ALDRIC_ROOM_ID;
const salon = aldric.map.rooms[0]!;

/** El Rey Aldric sembrado en el draft SIN decoración ni luces. */
async function createDeps() {
  const bare: RoomPackage = {
    ...aldric,
    map: {
      ...aldric.map,
      rooms: aldric.map.rooms.map((room) => ({ ...room, decorations: [], lighting: [] })),
    },
  };
  const store = createInMemoryRoomDraftStore([{ id: roomId, authorId: AUTHOR.userId }]);
  const drafts = createRoomDraftService({ store });
  const doc = roomPackageToDoc(bare);
  await drafts.appendUpdate(AUTHOR, roomId, Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const deps: CreatorMcpDeps = {
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts,
    actor: AUTHOR,
    roomDocToPackage,
    snapshotCache: new DraftSnapshotCache(),
  };
  return { deps, drafts, store };
}

async function connect(deps: CreatorMcpDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-decor-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

async function draftPackage(drafts: RoomDraftService): Promise<RoomPackage> {
  const doc = buildDraftDoc(await drafts.loadDraft(AUTHOR, roomId));
  try {
    return parseRoomPackage(roomDocToPackage(doc));
  } finally {
    doc.destroy();
  }
}

const reason = (result: Awaited<ReturnType<typeof call>>) =>
  (result.structured?.error as { reason?: string } | undefined)?.reason;

describe("decorate_subroom (paridad de decoración e iluminación)", () => {
  it("es una mutación de la fase de contenido con dryRun", () => {
    const tool = CREATOR_TOOLSET.find((entry) => entry.name === "decorate_subroom");
    expect(tool).toMatchObject({ phase: "content", annotations: { destructiveHint: true } });
    expect(Object.keys(tool!.inputSchema.shape)).toEqual([
      "roomId",
      "subroomId",
      "decorations",
      "lighting",
      "dryRun",
    ]);
  });

  it("escribe decoración y luces exactamente como el fixture", async () => {
    const { deps, drafts } = await createDeps();
    const client = await connect(deps);
    const result = await call(client, "decorate_subroom", {
      roomId,
      subroomId: salon.id,
      decorations: salon.decorations,
      lighting: salon.lighting,
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toMatch(
      /^✅ decorate_subroom — "salon-trono": 6 decoración\(es\); 1 antorcha\(s\), ambiente #3a2f22 al 0.6/,
    );
    expect(result.structured).toMatchObject({
      roomId,
      subroomId: salon.id,
      decorations: 6,
      lights: 2,
    });
    const room = (await draftPackage(drafts)).map.rooms[0]!;
    expect(room.decorations).toEqual(salon.decorations);
    expect(room.lighting).toEqual(salon.lighting);

    // Repetirlo no cambia nada; omitir una lista la conserva; `[]` la vacía.
    const same = await call(client, "decorate_subroom", {
      roomId,
      subroomId: salon.id,
      lighting: salon.lighting,
    });
    expect(same.text).toContain("ℹ️ Sin cambios: el draft ya estaba así.");
    const cleared = await call(client, "decorate_subroom", {
      roomId,
      subroomId: salon.id,
      decorations: [],
    });
    expect(cleared.isError, cleared.text).toBe(false);
    const after = (await draftPackage(drafts)).map.rooms[0]!;
    expect(after.decorations).toEqual([]);
    expect(after.lighting).toEqual(salon.lighting);
  });

  it("dryRun: true valida y describe sin escribir en el draft", async () => {
    const { deps, drafts, store } = await createDeps();
    const client = await connect(deps);
    const before = await draftPackage(drafts);
    const updates = await store.countUpdatesAfter(roomId, 0n);

    const ok = await call(client, "decorate_subroom", {
      roomId,
      subroomId: "bodega",
      decorations: aldric.map.rooms[1]!.decorations,
      dryRun: true,
    });
    expect(ok.isError, ok.text).toBe(false);
    expect(ok.text).toMatch(/^🧪 decorate_subroom \(dry-run\) — "bodega": 4 decoración\(es\)/);
    expect(ok.text).toContain("🧪 dryRun: true — no se ha escrito nada en el draft.");
    expect(ok.structured).toMatchObject({ dryRun: true, validation: { ok: true } });

    // Un error en ensayo es el mismo error, y tampoco escribe.
    const bad = await call(client, "decorate_subroom", {
      roomId,
      subroomId: "bodega",
      lighting: [{ type: "torch", x: 3, y: 1, objectId: "fantasma" }],
      dryRun: true,
    });
    expect(bad.isError).toBe(true);
    expect(reason(bad)).toBe("UNKNOWN_OBJECT");

    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(updates);
    expect(await draftPackage(drafts)).toEqual(before);
  });

  it("errores accionables: habitación, objeto, celda, color, intensidad y entrada vacía", async () => {
    const { deps, drafts } = await createDeps();
    const client = await connect(deps);
    const before = await draftPackage(drafts);

    const room = await call(client, "decorate_subroom", {
      roomId,
      subroomId: "desvan",
      decorations: [{ sprite: "columna", x: 0, y: 0 }],
    });
    expect(errorCode(room)).toBe("NOT_FOUND");
    expect(room.text).toContain("Habitaciones disponibles: [salon-trono, bodega, catacumbas]");

    const object = await call(client, "decorate_subroom", {
      roomId,
      subroomId: "bodega",
      lighting: [{ type: "torch", x: 3, y: 1, objectId: "fantasma" }],
    });
    expect(errorCode(object)).toBe("NOT_FOUND");
    expect(object.text).toContain('No existe el objeto "fantasma" que gobierna la antorcha');
    expect(object.text).toContain("Objetos disponibles: [");

    const outside = await call(client, "decorate_subroom", {
      roomId,
      subroomId: "bodega",
      decorations: [{ sprite: "barriles", x: 18, y: 2 }],
    });
    expect(errorCode(outside)).toBe("INVALID_INPUT");
    expect(reason(outside)).toBe("OUT_OF_BOUNDS");

    for (const ambient of [
      { color: "marrón", intensity: 0.5 },
      { color: "#2a1f16", intensity: 1.5 },
    ]) {
      const bad = await call(client, "decorate_subroom", {
        roomId,
        subroomId: "bodega",
        lighting: [{ type: "ambient", ...ambient }],
      });
      expect(errorCode(bad)).toBe("INVALID_INPUT");
      expect(reason(bad)).toBe("INVALID_VALUE");
    }

    const empty = await call(client, "decorate_subroom", { roomId, subroomId: "bodega" });
    expect(errorCode(empty)).toBe("INVALID_INPUT");
    expect(empty.text).toContain("indica `decorations`, `lighting` o ambas");

    expect(await draftPackage(drafts)).toEqual(before);
  });
});
