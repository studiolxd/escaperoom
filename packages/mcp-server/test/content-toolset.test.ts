import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import { EditorSyncProvider } from "@escaperoom/editor";
import { createEditorSyncServer } from "@escaperoom/editor/sync-server";
import { RoomPackageSchema, type RoomPackage } from "@escaperoom/shared/schemas";
import {
  ANONYMOUS_ACTOR,
  buildDraftDoc,
  createCatalogService,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createRoomDraftService,
  type Actor,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import * as Y from "yjs";
import {
  CREATOR_TOOLSET,
  ToolError,
  createCreatorMcpServer,
  startHttpServer,
  type CreatorMcpDeps,
} from "../src";
import { call, errorCode } from "./fixtures/client";
import { AUTHOR, loadAldric } from "./fixtures/drafts";
import { CRYPT, LAB, SMALL_ROOM_META, buildSmallRoom } from "./fixtures/small-room";

const OTHER: Actor = { userId: "otra-persona", organizationId: null, role: "member" };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** Servicios en memoria SIN salas: las crea `create_room`. Conversión real de 3.1. */
function createEmptyDeps(actor: Actor | null, extra: Partial<CreatorMcpDeps> = {}) {
  const store = createInMemoryRoomDraftStore();
  const drafts = extra.drafts ?? createRoomDraftService({ store });
  const deps: CreatorMcpDeps = {
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts,
    actor,
    roomDocToPackage,
    ...extra,
  };
  return { deps, drafts, store };
}

async function connect(deps: CreatorMcpDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-4.2-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

/** RoomPackage del draft tal y como lo ve el editor: `roomDocToPackage` del doc persistido. */
async function draftPackage(drafts: RoomDraftService, roomId: string): Promise<RoomPackage> {
  const doc = buildDraftDoc(await drafts.loadDraft(AUTHOR, roomId));
  try {
    return roomDocToPackage(doc);
  } finally {
    doc.destroy();
  }
}

function expectSmallRoom(pkg: RoomPackage, roomId: string): void {
  // Válido por esquema: el contrato que consumen runtime, validador y publicación.
  const parsed = RoomPackageSchema.safeParse(pkg);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

  expect(pkg.meta).toMatchObject({
    ...SMALL_ROOM_META,
    id: roomId,
    authorId: AUTHOR.userId,
    version: "0.0.0",
    assetsManifest: "r2://assets/packs/medieval-v1/manifest.json",
  });
  expect(pkg.map.tileset).toBe("medieval-v1");
  expect(pkg.map.rooms.map((room) => [room.id, room.grid])).toEqual([
    [LAB, { cols: 10, rows: 8 }],
    [CRYPT, { cols: 8, rows: 6 }],
  ]);
  const [lab, crypt] = pkg.map.rooms;
  expect(lab?.layers).toEqual([{ name: "ground", rle: Array(8).fill([10, 1]).flat() }]);
  expect(lab?.spawnPoints).toEqual([{ id: "spawn-1", x: 5, y: 6 }]);
  expect(crypt?.layers.map((layer) => layer.name)).toEqual(["ground", "walls"]);
  expect(crypt?.layers[1]?.rle.slice(0, 2)).toEqual([8, 7]);
  expect(pkg.objects.map((object) => object.id)).toEqual(["cofre-lab", "puerta-cripta"]);
  expect(pkg.objects[1]).toMatchObject({ lockedBy: "llave-cripta", leadsTo: CRYPT });
  expect(pkg.items).toEqual([
    {
      id: "llave-cripta",
      icon: "icon-llave",
      name: { es: { text: "Llave de la cripta" }, en: { text: "Crypt key" } },
    },
  ]);
  expect(pkg.puzzles).toMatchObject([{ id: "p-cofre", type: "code_lock", code: "314" }]);
  expect(pkg.dialogs.map((dialog) => dialog.id)).toEqual(["d-intro"]);
  expect(pkg.hints).toEqual([
    {
      id: "hint-cofre-1",
      puzzleId: "p-cofre",
      tier: 1,
      cost: 1,
      text: { es: { text: "Contad los frascos de cada estante." } },
    },
  ]);
  expect(pkg.rules).toEqual([]);
}

describe("toolset de estructura y contenido (4.2)", () => {
  it("implementa las tools de las fases A y B más el catálogo de plantillas", () => {
    const implemented = CREATOR_TOOLSET.filter((tool) => tool.run && tool.ticket === "4.2");
    expect(implemented.map((tool) => tool.name)).toEqual([
      "create_room",
      "set_map",
      "paint_tiles",
      "define_subrooms",
      "add_object",
      "define_item",
      "add_puzzle",
      "add_dialog",
      "add_hint",
      "get_template_catalog",
    ]);
  });

  it("un cliente MCP crea un draft completo y roomDocToPackage da un RoomPackage válido", async () => {
    const { deps, drafts } = createEmptyDeps(AUTHOR);
    const client = await connect(deps);
    const roomId = await buildSmallRoom(client);

    expectSmallRoom(await draftPackage(drafts, roomId), roomId);

    // get_room (4.1) lee lo mismo por el MCP.
    const room = await call(client, "get_room", { roomId });
    expect(room.isError).toBe(false);
    expect(room.structured?.room).toEqual(await draftPackage(drafts, roomId));
  });

  it("por HTTP streamable (puerto libre) con la identidad de la sesión", async () => {
    const { deps, drafts } = createEmptyDeps(null);
    const http = await startHttpServer({
      port: 0,
      authenticate: async (request) =>
        request.headers.get("x-test-user") === AUTHOR.userId ? AUTHOR : null,
      createDeps: () => deps,
    });
    cleanups.push(() => http.close());
    const client = new Client({ name: "http-4.2", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(http.url, {
        requestInit: { headers: { "x-test-user": AUTHOR.userId } },
      }),
    );
    cleanups.push(() => client.close());

    const roomId = await buildSmallRoom(client);
    expectSmallRoom(await draftPackage(drafts, roomId), roomId);
  });

  it("cada tool es una transacción: un update por llamada y nada si falla", async () => {
    const { deps, store } = createEmptyDeps(AUTHOR);
    const client = await connect(deps);
    const roomId = await buildSmallRoom(client);
    const count = () => store.countUpdatesAfter(roomId, 0n);
    // create_room + 10 mutaciones del guion.
    expect(await count()).toBe(11);

    const failed = await call(client, "add_object", {
      roomId,
      object: {
        id: "estatua",
        roomId: LAB,
        type: "estatua",
        position: { x: 50, y: 50 },
        sprite: "estatua",
        states: {},
        initialState: "",
        interactable: true,
      },
    });
    expect(failed.isError).toBe(true);
    expect(await count()).toBe(11);

    // Repetir un pincel que no cambia nada no escribe.
    const same = await call(client, "paint_tiles", {
      roomId,
      subroomId: CRYPT,
      layer: "walls",
      cells: [{ x: 0, y: 0, tile: 7 }],
    });
    expect(same.structured?.changed).toBe(0);
    expect(await count()).toBe(11);
  });
});

describe("errores legibles", () => {
  async function withSmallRoom() {
    const { deps, drafts, store } = createEmptyDeps(AUTHOR);
    const client = await connect(deps);
    const roomId = await buildSmallRoom(client);
    return { client, drafts, store, roomId };
  }

  it("una referencia inexistente lista las disponibles (specs/10 §3)", async () => {
    const { client, roomId } = await withSmallRoom();
    const object = await call(client, "add_object", {
      roomId,
      object: {
        id: "barril",
        roomId: "bodega",
        type: "barril",
        position: { x: 1, y: 1 },
        sprite: "barril",
        states: {},
        initialState: "",
        interactable: false,
      },
    });
    expect(object.isError).toBe(true);
    expect(errorCode(object)).toBe("NOT_FOUND");
    expect(object.text).toBe(
      `❌ add_object: No existe la habitación "bodega". Habitaciones disponibles: [${LAB}, ${CRYPT}]`,
    );
    expect(object.structured?.error).toMatchObject({
      reason: "UNKNOWN_ROOM",
      available: [LAB, CRYPT],
    });

    const hint = await call(client, "add_hint", {
      roomId,
      hint: { puzzleId: "p-arca", tier: 1, text: { es: { text: "…" } }, cost: 1 },
    });
    expect(hint.text).toBe(
      '❌ add_hint: No existe el puzzle "p-arca". Puzzles disponibles: [p-cofre]',
    );
  });

  it("un id repetido sugiere replace, que sustituye la entrada", async () => {
    const { client, drafts, roomId } = await withSmallRoom();
    const item = {
      id: "llave-cripta",
      name: { es: { text: "Llave oxidada" } },
      icon: "icon-llave-oxidada",
    };
    const duplicate = await call(client, "define_item", { roomId, item });
    expect(errorCode(duplicate)).toBe("INVALID_INPUT");
    expect(duplicate.text).toContain('Ya existe el id "llave-cripta"');
    expect(duplicate.text).toContain("replace: true");

    // Un id del espacio compartido tampoco puede repetirse entre colecciones.
    const clash = await call(client, "define_item", { roomId, item: { ...item, id: "cofre-lab" } });
    expect(clash.text).toContain('Ya existe el id "cofre-lab"');

    const replaced = await call(client, "define_item", { roomId, item, replace: true });
    expect(replaced.isError).toBe(false);
    expect(replaced.structured?.replaced).toBe(true);
    const pkg = await draftPackage(drafts, roomId);
    expect(pkg.items).toEqual([item]);
  });

  it("celdas fuera de la rejilla, idiomas no declarados y RLE mal formado", async () => {
    const { client, roomId } = await withSmallRoom();
    const paint = await call(client, "paint_tiles", {
      roomId,
      subroomId: CRYPT,
      layer: "ground",
      cells: [
        { x: 1, y: 1, tile: 3 },
        { x: 8, y: 0, tile: 3 },
      ],
    });
    expect(paint.text).toBe(
      '❌ paint_tiles: 1 celda(s) fuera de la habitación "cripta" (8×6): (8, 0)',
    );

    const dialog = await call(client, "add_dialog", {
      roomId,
      dialog: { id: "d-fr", text: { fr: { text: "Bonjour" } } },
    });
    expect(errorCode(dialog)).toBe("INVALID_INPUT");
    expect(dialog.text).toBe(
      '❌ add_dialog: "d-fr.text" usa idiomas no declarados en la sala (fr); idiomas de la sala: es, en',
    );

    const map = await call(client, "set_map", {
      roomId,
      tileset: "medieval-v1",
      size: { cols: 2, rows: 2 },
      layers: [{ name: "ground", rle: [4] }],
    });
    expect(map.text).toContain("RLE mal formado");
  });

  it("la entrada se valida con los esquemas Zod compartidos", async () => {
    const { client, roomId } = await withSmallRoom();
    const puzzle = await call(client, "add_puzzle", {
      roomId,
      puzzle: { id: "p-x", type: "code_lock", roomId: LAB, layer: "panel" },
    });
    expect(puzzle.isError).toBe(true);
    expect(puzzle.text).toMatch(/validation/i);
    expect(puzzle.text).toContain("code");
  });

  it("create_room rechaza metadata incoherente sin dar de alta la sala", async () => {
    const { deps } = createEmptyDeps(AUTHOR);
    let created = 0;
    const drafts = deps.drafts;
    const client = await connect({
      ...deps,
      drafts: {
        ...drafts,
        createDraft: (...args) => {
          created++;
          return drafts.createDraft(...args);
        },
      },
    });
    const language = await call(client, "create_room", {
      meta: { ...SMALL_ROOM_META, defaultLanguage: "fr" },
    });
    expect(errorCode(language)).toBe("INVALID_INPUT");
    expect(language.text).toContain('El idioma por defecto "fr" no está entre los declarados');

    const players = await call(client, "create_room", {
      meta: { ...SMALL_ROOM_META, players: { min: 3, max: 2 } },
    });
    expect(players.text).toContain("1 ≤ min ≤ max");
    expect(created).toBe(0);
  });

  it("set_map con size antes de definir habitaciones pide define_subrooms", async () => {
    const { deps } = createEmptyDeps(AUTHOR);
    const client = await connect(deps);
    const created = await call(client, "create_room", { meta: SMALL_ROOM_META });
    const roomId = String(created.structured?.roomId);
    const map = await call(client, "set_map", {
      roomId,
      tileset: "medieval-v1",
      size: { cols: 4, rows: 4 },
    });
    expect(map.text).toContain("defínelas primero con define_subrooms");
    // Solo el tileset sí se puede fijar antes.
    expect((await call(client, "set_map", { roomId, tileset: "cripta-v1" })).isError).toBe(false);
  });

  it("el enganche previo al commit (4.4) puede rechazar la mutación sin escribir", async () => {
    const { deps, store } = createEmptyDeps(AUTHOR);
    const roomId = await buildSmallRoom(await connect(deps));
    const seen: string[] = [];
    const client = await connect({
      ...deps,
      beforeCommit: ({ tool, doc }) => {
        seen.push(tool);
        if (roomDocToPackage(doc).dialogs.length > 1) {
          throw new ToolError("INVALID_INPUT", "el validador incremental lo rechaza");
        }
      },
    });
    const before = await store.countUpdatesAfter(roomId, 0n);
    const result = await call(client, "add_dialog", {
      roomId,
      dialog: { id: "d-otro", text: { es: { text: "Otro" } } },
    });
    expect(result.text).toBe("❌ add_dialog: el validador incremental lo rechaza");
    expect(seen).toEqual(["add_dialog"]);
    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(before);
  });
});

describe("auth: solo drafts propios", () => {
  it("un creador no puede tocar el draft de otro", async () => {
    const { deps, drafts, store } = createEmptyDeps(AUTHOR);
    const roomId = await buildSmallRoom(await connect(deps));
    const before = await store.countUpdatesAfter(roomId, 0n);

    const intruder = await connect({ ...deps, actor: OTHER });
    const calls: Array<[string, Record<string, unknown>]> = [
      ["set_map", { roomId, tileset: "otro" }],
      [
        "define_subrooms",
        { roomId, subrooms: [{ id: "x", name: "X", bounds: { x: 0, y: 0, w: 2, h: 2 } }] },
      ],
      [
        "paint_tiles",
        { roomId, subroomId: LAB, layer: "ground", cells: [{ x: 0, y: 0, tile: 9 }] },
      ],
      ["define_item", { roomId, item: { id: "robo", name: { es: { text: "Robo" } }, icon: "i" } }],
      ["add_dialog", { roomId, dialog: { id: "d-robo", text: { es: { text: "…" } } } }],
    ];
    for (const [name, args] of calls) {
      const result = await call(intruder, name, args);
      expect(result.isError, name).toBe(true);
      expect(errorCode(result), name).toBe("FORBIDDEN");
    }
    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(before);
    expectSmallRoom(await draftPackage(drafts, roomId), roomId);
  });

  it("sin identidad no se crea nada", async () => {
    for (const actor of [null, ANONYMOUS_ACTOR]) {
      const { deps } = createEmptyDeps(actor);
      const client = await connect(deps);
      const result = await call(client, "create_room", { meta: SMALL_ROOM_META });
      expect(errorCode(result)).toBe("UNAUTHORIZED");
    }
  });
});

describe("con una sesión de edición viva (3.3)", () => {
  it("los editores conectados ven la mutación del MCP al instante", async () => {
    const store = createInMemoryRoomDraftStore();
    const drafts = createRoomDraftService({ store, snapshotEvery: 1000 });
    const sync = createEditorSyncServer({
      drafts,
      resolveActor: async (request) =>
        request.headers["x-test-user"] === AUTHOR.userId ? AUTHOR : ANONYMOUS_ACTOR,
      pingIntervalMs: 0,
      logger: { warn: () => undefined, error: () => undefined },
    });
    const { port } = await sync.listen(0, "127.0.0.1");
    cleanups.push(() => sync.close());

    const { deps } = createEmptyDeps(AUTHOR, { drafts, liveSync: sync });
    const client = await connect(deps);
    const roomId = await buildSmallRoom(client);

    // Un editor abre la sala por el WebSocket de edición.
    const editorDoc = new Y.Doc();
    const provider = new EditorSyncProvider({
      url: `ws://127.0.0.1:${port}`,
      roomId,
      doc: editorDoc,
      createWebSocket: (url) =>
        new WsWebSocket(url, { headers: { "x-test-user": AUTHOR.userId } }) as unknown as WebSocket,
    });
    cleanups.push(() => provider.destroy());
    await waitFor(() => roomDocToPackage(editorDoc).objects.length === 2);
    expect(sync.loadedRooms()).toEqual([roomId]);

    const result = await call(client, "add_object", {
      roomId,
      object: {
        id: "caldero",
        roomId: CRYPT,
        type: "decorativo",
        position: { x: 4, y: 3 },
        sprite: "caldero",
        states: {},
        initialState: "",
        interactable: false,
      },
    });
    expect(result.isError).toBe(false);
    // Llega al editor por el doc vivo, sin recargar…
    await waitFor(() => roomDocToPackage(editorDoc).objects.some((o) => o.id === "caldero"));
    // …y queda persistida en el draft.
    expect((await draftPackage(drafts, roomId)).objects.map((o) => o.id)).toContain("caldero");
  });
});

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
