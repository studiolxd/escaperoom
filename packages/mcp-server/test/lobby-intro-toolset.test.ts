import {
  defineSubRooms,
  paintTiles,
  roomDocToPackage,
  roomPackageToDoc,
  setDecorations,
  setRoomIntro,
} from "@escaperoom/editor/room-doc";
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
import { CONTENT_TOOLSET, createCreatorMcpServer, type CreatorMcpDeps } from "../src";
import { call, errorCode } from "./fixtures/client";
import { AUTHOR, loadAldric } from "./fixtures/drafts";
import { buildSmallRoom } from "./fixtures/small-room";

/**
 * Encargo lobby-diseño: la sala de espera (`kind: "lobby"` en
 * `define_subrooms`) y la introducción (`set_room_intro`) por MCP, con los
 * MISMOS comandos de `room-doc` que usa el editor (paridad editor ↔ MCP).
 */

const VIDEO = "media:3f1c1b8e-2d7a-4a57-9c1f-6f5f0b4c2a11";
const VTT_ES = "media:0b8f6a3e-54a1-4c3e-8a0e-9d2b7c1f4e22";
const LOBBY = "espera";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function setup(): Promise<{ client: Client; drafts: RoomDraftService; roomId: string }> {
  const drafts = createRoomDraftService({ store: createInMemoryRoomDraftStore() });
  const deps: CreatorMcpDeps = {
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts,
    actor: AUTHOR,
    roomDocToPackage,
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-lobby-intro", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  const roomId = await buildSmallRoom(client);
  return { client, drafts, roomId };
}

async function draftPackage(drafts: RoomDraftService, roomId: string): Promise<RoomPackage> {
  const doc = buildDraftDoc(await drafts.loadDraft(AUTHOR, roomId));
  try {
    return roomDocToPackage(doc);
  } finally {
    doc.destroy();
  }
}

const lobbyFloor = () => {
  const cells = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) cells.push({ x, y });
  return cells;
};

describe("catálogo", () => {
  it("set_room_intro está en el toolset de contenido y find_tools la encuentra", async () => {
    expect(CONTENT_TOOLSET.map((tool) => tool.name)).toContain("set_room_intro");
    const { client } = await setup();
    const found = await call(client, "find_tools", { query: "introducción vídeo" });
    expect(found.text).toContain("set_room_intro");
    const lobby = await call(client, "find_tools", { query: "lobby" });
    expect(lobby.text).toContain("define_subrooms");
  });
});

describe("define_subrooms con kind: lobby", () => {
  it("crea la sala de espera, get_room la refleja y se decora como cualquier otra", async () => {
    const { client, drafts, roomId } = await setup();
    const result = await call(client, "define_subrooms", {
      roomId,
      subrooms: [
        { id: LOBBY, name: "Sala de espera", bounds: { x: 0, y: 0, w: 6, h: 5 }, kind: "lobby" },
      ],
    });
    expect(result.isError, result.text).toBe(false);
    const paint = await call(client, "paint_tiles", {
      roomId,
      subroomId: LOBBY,
      layer: "ground",
      cells: lobbyFloor().map((cell) => ({ ...cell, tile: 1 })),
    });
    expect(paint.isError, paint.text).toBe(false);
    const decorate = await call(client, "decorate_subroom", {
      roomId,
      subroomId: LOBBY,
      decorations: [{ sprite: "barril", x: 2, y: 2 }],
    });
    expect(decorate.isError, decorate.text).toBe(false);

    const room = await call(client, "get_room", { roomId });
    const rooms = (room.structured?.room as RoomPackage).map.rooms;
    expect(rooms.find((r) => r.id === LOBBY)).toMatchObject({
      kind: "lobby",
      decorations: [{ sprite: "barril", x: 2, y: 2 }],
    });
    const pkg = await draftPackage(drafts, roomId);
    expect(parseRoomPackage(pkg).map.rooms.find((r) => r.id === LOBBY)?.kind).toBe("lobby");
  });

  it("rechaza un segundo lobby con un mensaje claro y sin escribir", async () => {
    const { client, drafts, roomId } = await setup();
    await call(client, "define_subrooms", {
      roomId,
      subrooms: [{ id: LOBBY, name: "Espera", bounds: { x: 0, y: 0, w: 6, h: 5 }, kind: "lobby" }],
    });
    const before = await draftPackage(drafts, roomId);
    const second = await call(client, "define_subrooms", {
      roomId,
      subrooms: [{ id: "otra", name: "Otra", bounds: { x: 0, y: 0, w: 4, h: 4 }, kind: "lobby" }],
    });
    expect(second.isError).toBe(true);
    expect(second.text).toContain("Solo puede haber una sala de espera");
    expect(await draftPackage(drafts, roomId)).toEqual(before);
  });

  it("kind: null quita el tipo", async () => {
    const { client, drafts, roomId } = await setup();
    const bounds = { x: 0, y: 0, w: 6, h: 5 };
    await call(client, "define_subrooms", {
      roomId,
      subrooms: [{ id: LOBBY, name: "Espera", bounds, kind: "lobby" }],
    });
    const removed = await call(client, "define_subrooms", {
      roomId,
      subrooms: [{ id: LOBBY, name: "Espera", bounds, kind: null }],
    });
    expect(removed.isError, removed.text).toBe(false);
    const room = (await draftPackage(drafts, roomId)).map.rooms.find((r) => r.id === LOBBY);
    expect(room).toBeDefined();
    expect(room).not.toHaveProperty("kind");
  });
});

describe("set_room_intro", () => {
  it("fija un texto localizado, luego un vídeo con subtítulos, y lo quita con null", async () => {
    const { client, drafts, roomId } = await setup();
    const text = await call(client, "set_room_intro", {
      roomId,
      intro: { type: "text", text: { es: { text: "Bienvenidos" }, en: { text: "Welcome" } } },
    });
    expect(text.isError, text.text).toBe(false);
    expect(text.text).toContain("✅ set_room_intro — introducción: texto (es, en)");
    expect((await draftPackage(drafts, roomId)).meta.intro).toEqual({
      type: "text",
      text: { es: { text: "Bienvenidos" }, en: { text: "Welcome" } },
    });

    const video = await call(client, "set_room_intro", {
      roomId,
      intro: { type: "video", video: VIDEO, subtitles: { es: VTT_ES } },
    });
    expect(video.isError, video.text).toBe(false);
    expect((await draftPackage(drafts, roomId)).meta.intro).toEqual({
      type: "video",
      video: VIDEO,
      subtitles: { es: VTT_ES },
    });

    const cleared = await call(client, "set_room_intro", { roomId, intro: null });
    expect(cleared.isError, cleared.text).toBe(false);
    expect((await draftPackage(drafts, roomId)).meta).not.toHaveProperty("intro");
  });

  it("rechaza idiomas no declarados y refs que no son de upload", async () => {
    const { client, roomId } = await setup();
    const undeclared = await call(client, "set_room_intro", {
      roomId,
      intro: { type: "text", text: { fr: { text: "Salut" } } },
    });
    expect(undeclared.isError).toBe(true);
    expect(undeclared.text).toContain("idiomas no declarados");

    const badRef = await call(client, "set_room_intro", {
      roomId,
      intro: { type: "video", video: "https://ejemplo.com/video.mp4" },
    });
    expect(badRef.isError).toBe(true);
    expect(errorCode(badRef) ?? badRef.text).toBeTruthy();
    expect(badRef.text).toContain("media:<uuid>");
  });

  it("dryRun no escribe", async () => {
    const { client, drafts, roomId } = await setup();
    const result = await call(client, "set_room_intro", {
      roomId,
      intro: { type: "video", video: VIDEO },
      dryRun: true,
    });
    expect(result.isError, result.text).toBe(false);
    expect((await draftPackage(drafts, roomId)).meta).not.toHaveProperty("intro");
  });
});

describe("paridad editor ↔ MCP: lobby e introducción", () => {
  it("las tools dan el mismo RoomPackage que los comandos del editor", async () => {
    const { client, drafts, roomId } = await setup();
    const before = await draftPackage(drafts, roomId);

    await call(client, "define_subrooms", {
      roomId,
      subrooms: [
        { id: LOBBY, name: "Sala de espera", bounds: { x: 0, y: 0, w: 6, h: 5 }, kind: "lobby" },
      ],
    });
    await call(client, "paint_tiles", {
      roomId,
      subroomId: LOBBY,
      layer: "ground",
      cells: lobbyFloor().map((cell) => ({ ...cell, tile: 1 })),
    });
    await call(client, "decorate_subroom", {
      roomId,
      subroomId: LOBBY,
      decorations: [{ sprite: "barril", x: 2, y: 2 }],
    });
    const intro = { type: "text" as const, text: { es: { text: "Hola" }, en: { text: "Hi" } } };
    await call(client, "set_room_intro", { roomId, intro });

    const doc = roomPackageToDoc(before);
    defineSubRooms(doc, [
      { id: LOBBY, name: "Sala de espera", grid: { cols: 6, rows: 5 }, kind: "lobby" },
    ]);
    paintTiles(doc, LOBBY, "ground", lobbyFloor(), 1);
    setDecorations(doc, LOBBY, [{ sprite: "barril", x: 2, y: 2 }]);
    setRoomIntro(doc, intro);

    expect(await draftPackage(drafts, roomId)).toEqual(roomDocToPackage(doc));
  });
});
