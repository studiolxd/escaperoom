import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import {
  createCatalogService,
  createInMemoryIntroMediaBlobStore,
  createInMemoryIntroMediaStore,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createIntroMediaService,
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

/** Encargo 7.8a: subida de modelos GLB propios y `remove_model` por MCP. */

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** GLB mínimo en memoria: una malla con la envolvente [0,0,0]–[2,1,4] y un clip. */
function glb(extra: Record<string, unknown> = {}): Uint8Array {
  const doc = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ count: 6, componentType: 5126, type: "VEC3", min: [0, 0, 0], max: [2, 1, 4] }],
    animations: [{ name: "abrir" }],
    ...extra,
  };
  const raw = new TextEncoder().encode(JSON.stringify(doc));
  const padded = new Uint8Array(Math.ceil(raw.length / 4) * 4).fill(0x20);
  padded.set(raw);
  const out = new Uint8Array(20 + padded.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, padded.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(padded, 20);
  return out;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function connect(actor: Actor = AUTHOR) {
  const introStore = createInMemoryIntroMediaStore();
  const blobs = createInMemoryIntroMediaBlobStore();
  const deps: CreatorMcpDeps = {
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts: createRoomDraftService({ store: createInMemoryRoomDraftStore() }),
    actor,
    roomDocToPackage,
    rooms3dEnabled: true,
    introMedia: createIntroMediaService({ store: introStore, blobs }),
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-7.8a-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, introStore, blobs };
}

async function ok(client: Client, name: string, args: Record<string, unknown>) {
  const result = await call(client, name, args);
  expect(result.isError, `${name}: ${result.text}`).toBe(false);
  return result;
}

async function create3dRoom(ctx: Awaited<ReturnType<typeof connect>>): Promise<string> {
  const created = await ok(ctx.client, "create_room", {
    meta: { ...SMALL_ROOM_META, dimension: "3d" },
  });
  const roomId = String(created.structured?.roomId);
  ctx.introStore.rooms.set(roomId, { id: roomId, authorId: AUTHOR.userId });
  await ok(ctx.client, "define_subrooms", {
    roomId,
    subrooms: [{ id: "salon", name: "Salón", bounds: { x: 0, y: 0, w: 6, h: 6 } }],
  });
  return roomId;
}

type CatalogModel = { id: string; custom: boolean; clips: string[]; size: { w: number } };

describe("MCP: modelos 3D propios (encargo 7.8a)", () => {
  it("upload kind model3d registra el modelo y get_model_catalog lo lista", async () => {
    const ctx = await connect();
    const roomId = await create3dRoom(ctx);
    const result = await ok(ctx.client, "upload", {
      kind: "model3d",
      roomId,
      modelId: "arca-mia",
      label: "Mi arca",
      filename: "arca.glb",
      contentType: "model/gltf-binary",
      data: b64(glb()),
    });
    expect(result.text).toContain('modelo "arca-mia" subido (2×4×1 m, 2 triángulos, clips: abrir)');
    expect(result.structured).toMatchObject({
      modelId: "arca-mia",
      ref: expect.stringMatching(/^media:/),
    });

    const catalog = await ok(ctx.client, "get_model_catalog", { roomId });
    const own = (catalog.structured?.models as CatalogModel[]).find((m) => m.id === "arca-mia");
    expect(own).toMatchObject({ custom: true, clips: ["abrir"], size: { w: 2 } });

    // El registro quedó en el documento, con colisionador y etiqueta.
    const room = await ok(ctx.client, "get_room", { roomId });
    const models = (room.structured?.room as { world3d: { models: Record<string, unknown> } })
      .world3d.models;
    expect(models["arca-mia"]).toMatchObject({
      label: "Mi arca",
      size: { w: 2, d: 4, hgt: 1 },
      colliders: [{ type: "box", sx: 2, sy: 4, sh: 1 }],
    });
  });

  it("la etiqueta por defecto es el nombre del fichero sin extensión", async () => {
    const ctx = await connect();
    const roomId = await create3dRoom(ctx);
    await ok(ctx.client, "upload", {
      kind: "model3d",
      roomId,
      modelId: "silla",
      filename: "silla.vieja.glb",
      contentType: "application/octet-stream",
      data: b64(glb()),
    });
    const room = await ok(ctx.client, "get_room", { roomId });
    const models = (
      room.structured?.room as { world3d: { models: Record<string, { label: string }> } }
    ).world3d.models;
    expect(models.silla!.label).toBe("silla.vieja");
  });

  it("sin modelId → INVALID_INPUT; sin roomId → INVALID_INPUT", async () => {
    const ctx = await connect();
    const roomId = await create3dRoom(ctx);
    const base = {
      kind: "model3d",
      filename: "a.glb",
      contentType: "model/gltf-binary",
      data: b64(glb()),
    };
    const noModelId = await call(ctx.client, "upload", { ...base, roomId });
    expect(noModelId.isError).toBe(true);
    expect(errorCode(noModelId)).toBe("INVALID_INPUT");
    expect(noModelId.text).toContain("modelId");
    const noRoom = await call(ctx.client, "upload", { ...base, modelId: "a" });
    expect(errorCode(noRoom)).toBe("INVALID_INPUT");
  });

  it("GLB inválido → error accionable y nada se registra", async () => {
    const ctx = await connect();
    const roomId = await create3dRoom(ctx);
    const bad = await call(ctx.client, "upload", {
      kind: "model3d",
      roomId,
      modelId: "malo",
      filename: "a.glb",
      contentType: "model/gltf-binary",
      data: b64(glb({ cameras: [{ type: "perspective" }] })),
    });
    expect(bad.isError).toBe(true);
    expect(errorCode(bad)).toBe("INVALID_INPUT");
    expect(bad.text).toMatch(/cámaras/);
    const notGlb = await call(ctx.client, "upload", {
      kind: "model3d",
      roomId,
      modelId: "malo",
      filename: "a.glb",
      contentType: "model/gltf-binary",
      data: b64(new TextEncoder().encode("no soy un glb")),
    });
    expect(errorCode(notGlb)).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(ctx.introStore.rows.size).toBe(0);
  });

  it("si el registro falla (id del catálogo), el asset subido se queda y el error se devuelve", async () => {
    const ctx = await connect();
    const roomId = await create3dRoom(ctx);
    const catalog = await ok(ctx.client, "get_model_catalog", { roomId });
    const packModel = (catalog.structured?.models as CatalogModel[]).find((m) => !m.custom);
    expect(packModel).toBeDefined();
    const failed = await call(ctx.client, "upload", {
      kind: "model3d",
      roomId,
      modelId: packModel!.id,
      filename: "a.glb",
      contentType: "model/gltf-binary",
      data: b64(glb()),
    });
    expect(failed.isError).toBe(true);
    expect(ctx.introStore.rows.size).toBe(1);
  });

  it("en una sala 2D responde WRONG_DIMENSION", async () => {
    const ctx = await connect();
    const created = await ok(ctx.client, "create_room", { meta: SMALL_ROOM_META });
    const roomId = String(created.structured?.roomId);
    ctx.introStore.rooms.set(roomId, { id: roomId, authorId: AUTHOR.userId });
    const result = await call(ctx.client, "upload", {
      kind: "model3d",
      roomId,
      modelId: "arca",
      filename: "a.glb",
      contentType: "model/gltf-binary",
      data: b64(glb()),
    });
    expect(result.isError).toBe(true);
    expect((result.structured?.error as { reason?: string }).reason).toBe("WRONG_DIMENSION");
  });

  it("sin servicio de medios → NOT_AVAILABLE", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createCreatorMcpServer({
      catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
      drafts: createRoomDraftService({ store: createInMemoryRoomDraftStore() }),
      actor: AUTHOR,
      roomDocToPackage,
      rooms3dEnabled: true,
    });
    const client = new Client({ name: "mcp-7.8a-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    cleanups.push(async () => {
      await client.close();
      await server.close();
    });
    const result = await call(client, "upload", {
      kind: "model3d",
      roomId: "x",
      modelId: "a",
      filename: "a.glb",
      contentType: "model/gltf-binary",
      data: b64(glb()),
    });
    expect(errorCode(result)).toBe("NOT_AVAILABLE");
  });

  it("remove_model: libre se quita; en uso → REFERENCED_ID; inexistente → NOT_FOUND", async () => {
    const ctx = await connect();
    const roomId = await create3dRoom(ctx);
    expect(CREATOR_TOOL_NAMES).toContain("remove_model");
    for (const modelId of ["mesa", "libre"]) {
      await ok(ctx.client, "upload", {
        kind: "model3d",
        roomId,
        modelId,
        filename: `${modelId}.glb`,
        contentType: "model/gltf-binary",
        data: b64(glb()),
      });
    }
    await ok(ctx.client, "place_pieces", {
      roomId,
      subroomId: "salon",
      pieces: [{ model: "mesa", x: 1, y: 1, h: 0, yaw: 0 }],
    });

    const inUse = await call(ctx.client, "remove_model", { roomId, modelId: "mesa" });
    expect(inUse.isError).toBe(true);
    expect((inUse.structured?.error as { reason?: string }).reason).toBe("REFERENCED_ID");
    expect(inUse.text).toContain("mesa");

    const dry = await ok(ctx.client, "remove_model", { roomId, modelId: "libre", dryRun: true });
    expect(dry.text).toContain("dry-run");
    let catalog = await ok(ctx.client, "get_model_catalog", { roomId });
    expect((catalog.structured?.models as CatalogModel[]).some((m) => m.id === "libre")).toBe(true);

    await ok(ctx.client, "remove_model", { roomId, modelId: "libre" });
    catalog = await ok(ctx.client, "get_model_catalog", { roomId });
    expect((catalog.structured?.models as CatalogModel[]).some((m) => m.id === "libre")).toBe(
      false,
    );

    const missing = await call(ctx.client, "remove_model", { roomId, modelId: "libre" });
    expect(errorCode(missing)).toBe("NOT_FOUND");
    expect((missing.structured?.error as { reason?: string }).reason).toBe("UNKNOWN_MODEL");
  });
});
