import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import {
  createCatalogService,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createRoomDraftService,
  type Actor,
} from "@escaperoom/shared/services";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { CREATOR_TOOL_NAMES, createCreatorMcpServer, type CreatorMcpDeps } from "../src";
import { call, errorCode } from "./fixtures/client";
import { AUTHOR, loadAldric } from "./fixtures/drafts";
import { SMALL_ROOM_META } from "./fixtures/small-room";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function connect(actor: Actor, rooms3dEnabled: boolean): Promise<Client> {
  const deps: CreatorMcpDeps = {
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts: createRoomDraftService({ store: createInMemoryRoomDraftStore() }),
    actor,
    roomDocToPackage,
    rooms3dEnabled,
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-7.9-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

async function ok(client: Client, name: string, args: Record<string, unknown>) {
  const result = await call(client, name, args);
  expect(result.isError, `${name}: ${result.text}`).toBe(false);
  return result;
}

const SALON = "salon";

/** Sala 3D con una habitación de 6×6 m. */
async function create3dRoom(client: Client): Promise<string> {
  const created = await ok(client, "create_room", {
    meta: { ...SMALL_ROOM_META, dimension: "3d" },
  });
  const roomId = String(created.structured?.roomId);
  await ok(client, "define_subrooms", {
    roomId,
    subrooms: [{ id: SALON, name: "Salón", bounds: { x: 0, y: 0, w: 6, h: 6 } }],
  });
  return roomId;
}

type Piece = { id: string; model: string; x: number; y: number; h: number; yaw: number };

describe("MCP 3D (encargo 7.9)", () => {
  it("create_room con dimension 3d crea el borrador y get_room devuelve meta.dimension", async () => {
    const client = await connect(AUTHOR, true);
    const roomId = await create3dRoom(client);
    const room = await ok(client, "get_room", { roomId });
    expect((room.structured?.room as { meta: { dimension?: string } }).meta.dimension).toBe("3d");
  });

  it("sin rooms3dEnabled, dimension 3d responde NOT_AVAILABLE", async () => {
    const client = await connect(AUTHOR, false);
    const result = await call(client, "create_room", {
      meta: { ...SMALL_ROOM_META, dimension: "3d" },
    });
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("NOT_AVAILABLE");
  });

  it("guion completo: suelo, muros, spawn, objeto, mover, actualizar, listar y borrar", async () => {
    const client = await connect(AUTHOR, true);
    const roomId = await create3dRoom(client);

    const floor = await ok(client, "place_pieces", {
      roomId,
      subroomId: SALON,
      fill: { model: "suelo-piedra", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, h: 0 },
    });
    expect(floor.text).toContain('36 pieza(s) en "salon"');
    expect(floor.structured?.ids).toHaveLength(36);

    const walls = await ok(client, "place_pieces", {
      roomId,
      subroomId: SALON,
      pieces: [
        { model: "muro-piedra", x: 0.5, y: 0, h: 0, yaw: 0 },
        { model: "muro-piedra", x: 1.5, y: 0, h: 0, yaw: 0 },
        { model: "muro-piedra", x: 2.5, y: 0, h: 0, yaw: 0 },
        { model: "muro-piedra", x: 3.5, y: 0, h: 0, yaw: 0 },
      ],
    });
    const wallIds = walls.structured?.ids as string[];
    expect(wallIds).toHaveLength(4);

    await ok(client, "set_spawn_points", {
      roomId,
      subroomId: SALON,
      spawnPoints: [{ id: "inicio", x: 3, y: 3, h: 0, yaw: 180 }],
    });

    const added = await ok(client, "add_object", {
      roomId,
      object: {
        id: "arca",
        roomId: SALON,
        type: "decorativo",
        position: { x: 0, y: 0 },
        transform: { x: 2, y: 2, h: 0, yaw: 90 },
        sprite: "arca-cerrada",
        states: {},
        initialState: "",
        interactable: true,
      },
    });
    expect(added.text).toContain("(2, 2, 0) 90°");

    const moved = await ok(client, "move_object", {
      roomId,
      objectId: "arca",
      transform: { x: 4, y: 1, h: 0, yaw: 0 },
    });
    expect(moved.text).toContain('"arca" en (4, 1, 0) 0°');

    await ok(client, "update_pieces", {
      roomId,
      updates: [{ id: wallIds[0], yaw: 90, x: 0.5, y: 5 }],
    });

    const listed = await ok(client, "get_pieces", { roomId, subroomId: SALON, model: "muro-piedra" });
    const pieces = listed.structured?.pieces as Piece[];
    expect(pieces).toHaveLength(4);
    expect(pieces.find((p) => p.id === wallIds[0])).toMatchObject({ y: 5, yaw: 90 });
    expect(listed.text).toContain(`${wallIds[0]} muro-piedra 0.5 5 0 90`);

    const removed = await ok(client, "remove_pieces", {
      roomId,
      subroomId: SALON,
      model: "muro-piedra",
    });
    expect(removed.text).toContain("4 pieza(s) borradas");
    const left = await ok(client, "get_pieces", { roomId, subroomId: SALON });
    expect(left.structured?.pieces).toHaveLength(36);

    const byIds = await ok(client, "remove_pieces", {
      roomId,
      ids: (left.structured?.pieces as Piece[]).slice(0, 2).map((p) => p.id),
    });
    expect(byIds.text).toContain("2 pieza(s) borradas");

    // Una regla de victoria (la solvabilidad es lo único que falta en una sala vacía).
    await ok(client, "add_rule", {
      roomId,
      rule: {
        trigger: { type: "on_enter_room", roomId: SALON },
        conditions: [],
        actions: [{ type: "end_game", result: "victory" }],
      },
    });
    const validation = await ok(client, "validate", { roomId });
    expect(validation.structured?.ok, validation.text).toBe(true);
  });

  it("las herramientas 2D fallan en una sala 3D y las 3D en una 2D, con el aviso", async () => {
    const client = await connect(AUTHOR, true);
    const room3d = await create3dRoom(client);
    const paint = await call(client, "paint_tiles", {
      roomId: room3d,
      subroomId: SALON,
      layer: "suelo",
      cells: [{ x: 0, y: 0, tile: 1 }],
    });
    expect(paint.isError).toBe(true);
    expect(errorCode(paint)).toBe("INVALID_INPUT");
    expect(paint.structured?.error).toMatchObject({ reason: "WRONG_DIMENSION" });
    expect(paint.text).toContain("Esta sala es 3D: usa place_pieces");

    const created = await ok(client, "create_room", { meta: SMALL_ROOM_META });
    const room2d = String(created.structured?.roomId);
    await ok(client, "define_subrooms", {
      roomId: room2d,
      subrooms: [{ id: SALON, name: "Salón", bounds: { x: 0, y: 0, w: 6, h: 6 } }],
    });
    const place = await call(client, "place_pieces", {
      roomId: room2d,
      subroomId: SALON,
      pieces: [{ model: "suelo-piedra", x: 0.5, y: 0.5, h: 0, yaw: 0 }],
    });
    expect(place.isError).toBe(true);
    expect(errorCode(place)).toBe("INVALID_INPUT");
    expect(place.structured?.error).toMatchObject({ reason: "WRONG_DIMENSION" });
    expect(place.text).toContain("Esta sala es 2D: usa set_map, paint_tiles y decorate_subroom");

    const catalog = await call(client, "get_model_catalog", { roomId: room2d });
    expect(errorCode(catalog)).toBe("INVALID_INPUT");
  });

  it("set_map solo con tileset vale en una sala 3D", async () => {
    const client = await connect(AUTHOR, true);
    const roomId = await create3dRoom(client);
    await ok(client, "set_map", { roomId, tileset: "medieval-v1" });
  });

  it("dryRun en place_pieces no escribe", async () => {
    const client = await connect(AUTHOR, true);
    const roomId = await create3dRoom(client);
    const dry = await ok(client, "place_pieces", {
      roomId,
      subroomId: SALON,
      pieces: [{ model: "suelo-piedra", x: 0.5, y: 0.5, h: 0, yaw: 0 }],
      dryRun: true,
    });
    expect(dry.text).toContain("dry-run");
    const listed = await ok(client, "get_pieces", { roomId, subroomId: SALON });
    expect(listed.structured?.pieces).toEqual([]);
  });

  it("place_pieces y remove_pieces exigen exactamente una forma", async () => {
    const client = await connect(AUTHOR, true);
    const roomId = await create3dRoom(client);
    const none = await call(client, "place_pieces", { roomId, subroomId: SALON });
    expect(errorCode(none)).toBe("INVALID_INPUT");
    const both = await call(client, "place_pieces", {
      roomId,
      subroomId: SALON,
      pieces: [{ model: "suelo-piedra", x: 0.5, y: 0.5, h: 0, yaw: 0 }],
      fill: { model: "suelo-piedra", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, h: 0 },
    });
    expect(errorCode(both)).toBe("INVALID_INPUT");
    const removeNone = await call(client, "remove_pieces", { roomId });
    expect(errorCode(removeNone)).toBe("INVALID_INPUT");
    const missing = await call(client, "update_pieces", {
      roomId,
      updates: [{ id: "p-zzzzzzzz", x: 1 }],
    });
    expect(errorCode(missing)).toBe("NOT_FOUND");
  });

  it("add_object sin transform en una sala 3D es INVALID_INPUT", async () => {
    const client = await connect(AUTHOR, true);
    const roomId = await create3dRoom(client);
    const result = await call(client, "add_object", {
      roomId,
      object: {
        id: "arca",
        roomId: SALON,
        type: "decorativo",
        position: { x: 1, y: 1 },
        sprite: "arca-cerrada",
        states: {},
        initialState: "",
        interactable: true,
      },
    });
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("INVALID_INPUT");
  });

  it("get_model_catalog lista los modelos disponibles y filtra por categoría", async () => {
    const client = await connect(AUTHOR, true);
    const roomId = await create3dRoom(client);
    // El catálogo real del pack se rellena bajo demanda: hoy puede venir vacío.
    const all = await ok(client, "get_model_catalog", { roomId });
    const models = all.structured?.models as { id: string; category: string; size: object }[];
    expect(Array.isArray(models)).toBe(true);
    expect(all.text).toContain(`${models.length} modelo(s)`);
    const walls = await ok(client, "get_model_catalog", { roomId, category: "muro" });
    const filtered = walls.structured?.models as { category: string }[];
    expect(filtered.every((m) => m.category === "muro")).toBe(true);
    expect(filtered.length).toBe(models.filter((m) => m.category === "muro").length);
    const bad = await call(client, "get_model_catalog", { roomId, category: "inexistente" });
    expect(bad.isError).toBe(true);
  });

  it("get_room de una sala 3D omite suelos y muros y lo dice; includeFloorsAndWalls los trae (7.11)", async () => {
    const client = await connect(AUTHOR, true);
    const roomId = await create3dRoom(client);
    await ok(client, "set_map", { roomId, tileset: "medieval-v1" });
    const catalog = await ok(client, "get_model_catalog", { roomId });
    const models = catalog.structured?.models as { id: string; category: string }[];
    const floorModel = models.find((m) => m.category === "suelo")!.id;
    const wallModel = models.find((m) => m.category === "muro")!.id;
    await ok(client, "place_pieces", {
      roomId,
      subroomId: SALON,
      fill: { model: floorModel, from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, h: 0 },
    });
    await ok(client, "place_pieces", {
      roomId,
      subroomId: SALON,
      pieces: [
        { model: wallModel, x: 0.5, y: 0, h: 0, yaw: 0 },
        { model: wallModel, x: 1.5, y: 0, h: 0, yaw: 0 },
      ],
    });

    const room = await ok(client, "get_room", { roomId });
    const pkg = room.structured?.room as { world3d: { rooms: Record<string, { pieces: unknown[] }> } };
    expect(pkg.world3d.rooms[SALON]!.pieces).toEqual([]);
    expect(room.structured?.omitted).toEqual({
      [SALON]: {
        suelo: { count: 36, models: { [floorModel]: 36 } },
        muro: { count: 2, models: { [wallModel]: 2 } },
      },
    });
    const [json, note] = room.text.split("\n\n");
    expect(JSON.parse(json!)).toEqual(room.structured?.room);
    expect(note).toContain(`Omitidas 38 piezas de suelo y muro (por habitación: ${SALON}: 36 suelos, 2 muros)`);
    expect(note).toContain("get_pieces(");

    const full = await ok(client, "get_room", { roomId, includeFloorsAndWalls: true });
    const fullPkg = full.structured?.room as { world3d: { rooms: Record<string, { pieces: unknown[] }> } };
    expect(fullPkg.world3d.rooms[SALON]!.pieces).toHaveLength(38);
    expect(full.structured?.omitted).toBeUndefined();
    expect(JSON.parse(full.text)).toEqual(full.structured?.room);
  });

  it("get_room de una sala 3D sin suelos ni muros y de una sala 2D no cambia (sin omitted, texto = JSON)", async () => {
    const client = await connect(AUTHOR, true);
    const room3d = await create3dRoom(client);
    const empty = await ok(client, "get_room", { roomId: room3d });
    expect(empty.structured?.omitted).toBeUndefined();
    expect(JSON.parse(empty.text)).toEqual(empty.structured?.room);

    const created = await ok(client, "create_room", { meta: SMALL_ROOM_META });
    const room2d = String(created.structured?.roomId);
    const flat = await ok(client, "get_room", { roomId: room2d });
    expect(flat.structured?.omitted).toBeUndefined();
    expect(Object.keys(flat.structured ?? {})).toEqual(["room"]);
    expect(flat.text).toBe(JSON.stringify(flat.structured?.room));
  });

  it("get_pieces filtra por categoría (y con model) y pagina sin repetir ni saltarse piezas (7.11)", async () => {
    const client = await connect(AUTHOR, true);
    const roomId = await create3dRoom(client);
    await ok(client, "set_map", { roomId, tileset: "medieval-v1" });
    const catalog = await ok(client, "get_model_catalog", { roomId });
    const models = catalog.structured?.models as { id: string; category: string }[];
    const floors = models.filter((m) => m.category === "suelo");
    const floorModel = floors[0]!.id;
    const wallModel = models.find((m) => m.category === "muro")!.id;
    await ok(client, "place_pieces", {
      roomId,
      subroomId: SALON,
      fill: { model: floorModel, from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, h: 0 },
    });
    await ok(client, "place_pieces", {
      roomId,
      subroomId: SALON,
      pieces: [{ model: wallModel, x: 0.5, y: 0, h: 0, yaw: 0 }],
    });

    const suelos = await ok(client, "get_pieces", { roomId, subroomId: SALON, category: "suelo" });
    expect((suelos.structured?.pieces as Piece[]).every((p) => p.model === floorModel)).toBe(true);
    expect(suelos.structured).toMatchObject({ total: 36, offset: 0, limit: 300, nextOffset: null });
    expect(suelos.text.split("\n")[0]).toBe(`Piezas 1–36 de 36 en "${SALON}" (categoría suelo)`);

    const both = await ok(client, "get_pieces", {
      roomId,
      subroomId: SALON,
      category: "suelo",
      model: wallModel,
    });
    expect(both.structured?.total).toBe(0);
    expect(both.text).toBe(`0 pieza(s) en "${SALON}" (modelo ${wallModel}, categoría suelo)`);

    const seen: string[] = [];
    const sizes: number[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await ok(client, "get_pieces", {
        roomId,
        subroomId: SALON,
        category: "suelo",
        limit: 10,
        offset,
      });
      const pieces = page.structured?.pieces as Piece[];
      sizes.push(pieces.length);
      seen.push(...pieces.map((p) => p.id));
      const next = page.structured?.nextOffset as number | null;
      if (next !== null) expect(page.text.split("\n")[0]).toContain(`siguiente página: offset ${next}`);
      offset = next;
    }
    expect(sizes).toEqual([10, 10, 10, 6]);
    expect(new Set(seen).size).toBe(36);
    expect(seen).toEqual((suelos.structured?.pieces as Piece[]).map((p) => p.id));

    const out = await call(client, "get_pieces", { roomId, subroomId: SALON, category: "suelo", offset: 36 });
    expect(out.isError).toBe(true);
    expect(errorCode(out)).toBe("INVALID_INPUT");
    expect(out.text).toContain("36");

    const propio = await ok(client, "get_pieces", { roomId, subroomId: SALON, category: "propio" });
    expect(propio.structured?.total).toBe(0);
  });

  it("el toolset incluye las siete herramientas y find_tools las encuentra", async () => {
    for (const name of [
      "place_pieces",
      "update_pieces",
      "remove_pieces",
      "set_spawn_points",
      "move_object",
      "get_pieces",
      "get_model_catalog",
    ]) {
      expect(CREATOR_TOOL_NAMES).toContain(name);
    }
    const client = await connect(AUTHOR, true);
    for (const query of ["pieza", "3d"]) {
      const found = await ok(client, "find_tools", { query });
      expect(found.text).toContain("place_pieces");
    }
  });
});
