import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { roomDocToPackage } from "@escaperoom/editor/room-doc";
import { parseRoomPackage, type RoomPackage, type Rule } from "@escaperoom/shared/schemas";
import {
  buildDraftDoc,
  createCatalogService,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createRoomDraftService,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { validateRoomPackage } from "@escaperoom/shared/validator";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCreatorMcpServer, DraftSnapshotCache, type CreatorMcpDeps } from "../src";
import { aldric3dScript, PIECES_PER_CALL } from "./fixtures/aldric-3d-script";
import type { ScriptStep } from "./fixtures/aldric-script";
import { call } from "./fixtures/client";
import { AUTHOR, loadAldric } from "./fixtures/drafts";

/**
 * Paridad editor ↔ MCP del Rey Aldric 3D (encargo 7.10b, specs/27 §11). Como `mcp-parity.spec.ts`
 * (ticket 4.8), pero con la sala 3D: un cliente MCP del SDK construye «La Maldición del Rey Aldric
 * (3D)» ENTERA solo con el toolset (`place_pieces`, `set_spawn_points`, `add_object` con
 * `transform`…) y se comprueba que `validate` la da en verde, que tiene la MISMA ruta crítica que el
 * fixture 3D (y que la 2D) y que el RoomPackage resultante es equivalente al fixture.
 */

const fixture3dPath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric-3d.v1.json", import.meta.url),
);
const aldric3d = parseRoomPackage(JSON.parse(readFileSync(fixture3dPath, "utf8")) as unknown);
const aldric2d = parseRoomPackage(loadAldric());

type Built = {
  roomId: string;
  drafts: RoomDraftService;
  client: Client;
  log: Array<{ step: ScriptStep; text: string }>;
};

let built: Built;
let closeAll: () => Promise<void>;

async function run(client: Client, step: ScriptStep, log: Built["log"]) {
  const result = await call(client, step.tool, step.args);
  expect(result.isError, `${step.tool} «${step.label}»: ${result.text}`).toBe(false);
  expect(result.text.startsWith(`✅ ${step.tool}`), result.text).toBe(true);
  log.push({ step, text: result.text });
  return result;
}

beforeAll(async () => {
  const drafts = createRoomDraftService({ store: createInMemoryRoomDraftStore() });
  const deps: CreatorMcpDeps = {
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts,
    actor: AUTHOR,
    roomDocToPackage,
    rooms3dEnabled: true,
    snapshotCache: new DraftSnapshotCache(),
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-7.10b-paridad", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closeAll = async () => {
    await client.close();
    await server.close();
  };

  const log: Built["log"] = [];
  const script = aldric3dScript(aldric3d);
  const created = await run(client, script.createRoom, log);
  const roomId = String(created.structured?.roomId);
  for (const step of script.steps(roomId)) await run(client, step, log);
  built = { roomId, drafts, client, log };
  // ~900 piezas y ~250 llamadas con el validador incremental: sin carga ~7 s, con `pnpm verify:pr`
  // y otros paquetes en paralelo sube mucho más que el tope por defecto de los hooks (20 s).
}, 180_000);

afterAll(async () => {
  await closeAll?.();
});

async function draftPackage(): Promise<RoomPackage> {
  const doc = buildDraftDoc(await built.drafts.loadDraft(AUTHOR, built.roomId));
  try {
    return parseRoomPackage(roomDocToPackage(doc));
  } finally {
    doc.destroy();
  }
}

const byId = <T extends { id: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => a.id.localeCompare(b.id));

/** Clave de una pieza sin su id (lo genera el MCP): `roomId|model|x|y|h|yaw` (más `scale` si lo hay). */
const pieceKey = (roomId: string, p: { model: string; x: number; y: number; h: number; yaw: number; scale?: number }) =>
  [roomId, p.model, p.x, p.y, p.h, p.yaw, ...(p.scale === undefined ? [] : [p.scale])].join("|");

/**
 * Como `normalize` del test 2D (ids de plataforma y orden de las colecciones fuera), y además, para
 * el mundo 3D: las piezas se comparan como conjunto (se ignoran sus `id` y su orden).
 */
function normalize(pkg: RoomPackage): unknown {
  return {
    meta: { ...pkg.meta, id: "<plataforma>", authorId: "<plataforma>", version: "<plataforma>" },
    map: pkg.map,
    objects: byId(pkg.objects),
    items: byId(pkg.items),
    puzzles: byId(pkg.puzzles),
    rules: byId(pkg.rules),
    dialogs: byId(pkg.dialogs),
    hints: byId(pkg.hints),
    world3d: {
      pieces: Object.entries(pkg.world3d?.rooms ?? {})
        .flatMap(([roomId, room]) => room.pieces.map((piece) => pieceKey(roomId, piece)))
        .sort(),
      models: pkg.world3d?.models,
    },
  };
}

function ruleTieGroups(rules: readonly Rule[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const rule of rules) {
    const key = `${JSON.stringify(rule.trigger)}@${rule.priority}`;
    (groups[key] ??= []).push(rule.id);
  }
  return Object.fromEntries(Object.entries(groups).filter(([, ids]) => ids.length > 1));
}

describe("paridad editor ↔ MCP: el Rey Aldric 3D construido por MCP (7.10b)", () => {
  it("se construye solo con el toolset, sin atajos que escriban el doc", () => {
    const tools = new Set(built.log.map(({ step }) => step.tool));
    expect([...tools].sort()).toEqual(
      [
        "add_dialog",
        "add_hint",
        "add_object",
        "add_puzzle",
        "add_rule",
        "create_room",
        "decorate_subroom",
        "define_item",
        "define_subrooms",
        "place_pieces",
        "set_map",
        "set_spawn_points",
      ].sort(),
    );
    const sent = (tool: string, key: string) =>
      built.log.filter(({ step }) => step.tool === tool).map(({ step }) => step.args[key]);
    expect(sent("add_object", "object")).toEqual(expect.arrayContaining(aldric3d.objects));
    expect(sent("define_item", "item")).toEqual(expect.arrayContaining(aldric3d.items));
    expect(sent("add_puzzle", "puzzle")).toEqual(expect.arrayContaining(aldric3d.puzzles));
    expect(sent("add_rule", "rule")).toEqual(expect.arrayContaining(aldric3d.rules));
    expect(sent("add_dialog", "dialog")).toEqual(expect.arrayContaining(aldric3d.dialogs));
    expect(sent("add_hint", "hint")).toEqual(expect.arrayContaining(aldric3d.hints));
    expect(sent("decorate_subroom", "lighting")).toEqual(aldric3d.map.rooms.map((room) => room.lighting));
    expect(sent("decorate_subroom", "decorations")).toEqual(aldric3d.map.rooms.map(() => undefined));
  });

  it("coloca todas las piezas del fixture, en lotes de hasta 500", () => {
    const batches = built.log.filter(({ step }) => step.tool === "place_pieces");
    const sizes = batches.map(({ step }) => (step.args.pieces as unknown[]).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(PIECES_PER_CALL);
    expect(sizes.length).toBeGreaterThan(aldric3d.map.rooms.length - 1); // las catacumbas (~400) caben en un lote; el salón y la bodega, uno cada una
    const total = Object.values(aldric3d.world3d!.rooms).reduce((n, room) => n + room.pieces.length, 0);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("validate por MCP la da en verde y publicable", async () => {
    const result = await call(built.client, "validate", { roomId: built.roomId });
    expect(result.isError, result.text).toBe(false);
    expect(result.structured?.ok).toBe(true);
    expect(result.structured?.publishable).toBe(true);
    expect(result.text).toContain("📋 Checklist de publicación — 0 errores");
    expect(result.text).toContain("Secuencia de solución verificada");
    expect(built.log.at(-1)?.text).toContain("✅ Validador sin errores.");
  });

  it("el test de solvabilidad da la misma ruta crítica que el fixture 3D (y que el 2D)", async () => {
    const report = validateRoomPackage(await draftPackage());
    const expected = validateRoomPackage(aldric3d);
    expect(report.ok).toBe(true);
    expect(report.solvability.map((s) => [s.playerCount, s.solvable])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, true]),
    );
    expect(report.solvability).toEqual(expected.solvability);
    expect(report.criticalRoute).toEqual(expected.criticalRoute);
    expect(report.estimate).toEqual(expected.estimate);
    expect(report.criticalRoute!.steps.map((s) => s.subjectId)).toEqual(
      validateRoomPackage(aldric2d).criticalRoute!.steps.map((s) => s.subjectId),
    );
    expect(report.criticalRoute!.steps).toHaveLength(18);
    expect(report.criticalRoute!.steps.at(-1)?.victory).toBe(true);
  });

  it("el RoomPackage resultante es equivalente al fixture 3D", async () => {
    const pkg = await draftPackage();
    expect(normalize(pkg)).toEqual(normalize(aldric3d));

    expect(pkg.meta).toMatchObject({ authorId: AUTHOR.userId, version: "0.0.0", dimension: "3d" });
    expect(pkg.meta.id).toBe(built.roomId);
    for (const [index, room] of pkg.map.rooms.entries()) {
      const expected = aldric3d.map.rooms[index];
      expect(room.layers, room.id).toEqual([]);
      expect(room.decorations, room.id).toEqual([]);
      expect(room.lighting, room.id).toEqual(expected?.lighting);
    }
    expect(pkg.map.rooms[0]?.lighting).toContainEqual({ type: "torch", x: 4.5, y: 6.5, h: 1.6, objectId: "brasero" });
    expect(pkg.map.rooms.map((room) => room.id)).toEqual(aldric3d.map.rooms.map((room) => room.id));
    expect(ruleTieGroups(pkg.rules)).toEqual(ruleTieGroups(aldric3d.rules));
    // Los ids de pieza son únicos y con la forma del esquema (los generó el MCP, no el guion).
    const ids = Object.values(pkg.world3d!.rooms).flatMap((room) => room.pieces.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("get_room supera el tope de respuesta con las ~900 piezas: la vista por partes (get_pieces) da las mismas que ve el editor", async () => {
    // Sala 3D completa: `get_room` pasaría de 64 KB y el MCP responde con las vistas filtradas.
    const whole = await call(built.client, "get_room", { roomId: built.roomId });
    expect(whole.isError).toBe(true);
    expect(whole.text).toContain("supera el tope de 64 KB");

    const pkg = await draftPackage();
    for (const room of pkg.map.rooms) {
      const listed = await call(built.client, "get_pieces", { roomId: built.roomId, subroomId: room.id });
      expect(listed.isError, listed.text).toBe(false);
      expect(listed.structured?.pieces, room.id).toEqual(pkg.world3d!.rooms[room.id]!.pieces);
    }
  });
});
