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
import { aldricScript, type ScriptStep } from "./fixtures/aldric-script";
import { call } from "./fixtures/client";
import { AUTHOR, loadAldric } from "./fixtures/drafts";

/**
 * Ticket 4.8 — test E2E de paridad editor ↔ MCP (specs/22 §3.3). Un cliente MCP
 * del SDK construye «La Maldición del Rey Aldric» ENTERA solo con el toolset
 * (sin escribir el doc por otra vía) y se comprueba que:
 *
 * 1. `validate` la da en verde (publicable);
 * 2. el validador la da solvable para 1–4 jugadores con la MISMA ruta crítica
 *    que el fixture;
 * 3. el RoomPackage resultante (`roomDocToPackage` del draft, lo que ve el
 *    editor) es equivalente al fixture, salvo las diferencias no semánticas
 *    documentadas en `normalize`.
 *
 * Todo en memoria (servicios de dominio reales, conversión real de 3.1): es
 * determinista y sin red, y corre en cada PR (~2 s).
 */

const aldric = parseRoomPackage(loadAldric());

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
  // Un paso rechazado para el test en seco: el mensaje del MCP dice por qué.
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
    // Caché propia: el validador incremental no comparte fotos con otros tests.
    snapshotCache: new DraftSnapshotCache(),
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-4.8-paridad", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closeAll = async () => {
    await client.close();
    await server.close();
  };

  const log: Built["log"] = [];
  const script = aldricScript(aldric);
  const created = await run(client, script.createRoom, log);
  const roomId = String(created.structured?.roomId);
  for (const step of script.steps(roomId)) await run(client, step, log);
  built = { roomId, drafts, client, log };
});

afterAll(async () => {
  await closeAll?.();
});

/** RoomPackage del draft tal y como lo ve el editor: `roomDocToPackage` del doc persistido. */
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

/**
 * Diferencias NO semánticas entre la sala construida por MCP y el fixture:
 *
 * - `meta.id`, `meta.authorId`, `meta.version`: los asigna la plataforma (id
 *   del draft, actor que llama a `create_room`, semver de la publicación de
 *   3.9), no el autor. El fixture trae los del catálogo oficial.
 * - Orden de las colecciones (`objects`, `items`, `puzzles`, `rules`,
 *   `dialogs`, `hints`): el doc conserva el orden de alta y el validador
 *   incremental obliga a construir en orden de juego, no en el del fichero.
 *   Las entradas se comparan por id; el único orden con semántica (el
 *   desempate entre reglas del mismo disparador con la misma prioridad, que
 *   el motor resuelve por posición) se comprueba aparte.
 *
 * `map.rooms[].decorations` y `map.rooms[].lighting` NO se normalizan: los
 * escribe `decorate_subroom` con los mismos comandos de `room-doc` que usa el
 * editor (herramientas «Decorar»/«Antorcha» y panel de la sala).
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
  };
}

/** Ids de las reglas que compiten por el mismo disparador y prioridad, en orden. */
function ruleTieGroups(rules: readonly Rule[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const rule of rules) {
    const key = `${JSON.stringify(rule.trigger)}@${rule.priority}`;
    (groups[key] ??= []).push(rule.id);
  }
  return Object.fromEntries(Object.entries(groups).filter(([, ids]) => ids.length > 1));
}

describe("paridad editor ↔ MCP: el Rey Aldric construido por MCP (4.8)", () => {
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
        "paint_tiles",
        "set_map",
      ].sort(),
    );
    // Cada entidad del fixture se envió (al menos) una vez tal cual.
    const sent = (tool: string, key: string) =>
      built.log.filter(({ step }) => step.tool === tool).map(({ step }) => step.args[key]);
    expect(sent("add_object", "object")).toEqual(expect.arrayContaining(aldric.objects));
    expect(sent("define_item", "item")).toEqual(expect.arrayContaining(aldric.items));
    expect(sent("add_puzzle", "puzzle")).toEqual(expect.arrayContaining(aldric.puzzles));
    expect(sent("add_rule", "rule")).toEqual(expect.arrayContaining(aldric.rules));
    expect(sent("add_dialog", "dialog")).toEqual(expect.arrayContaining(aldric.dialogs));
    expect(sent("add_hint", "hint")).toEqual(expect.arrayContaining(aldric.hints));
    expect(sent("decorate_subroom", "decorations")).toEqual(
      aldric.map.rooms.map((room) => room.decorations),
    );
    expect(sent("decorate_subroom", "lighting")).toEqual(
      aldric.map.rooms.map((room) => room.lighting),
    );
  });

  it("validate por MCP la da en verde y publicable", async () => {
    const result = await call(built.client, "validate", { roomId: built.roomId });
    expect(result.isError, result.text).toBe(false);
    expect(result.structured?.ok).toBe(true);
    expect(result.structured?.publishable).toBe(true);
    expect(result.text).toContain("📋 Checklist de publicación — 0 errores");
    expect(result.text).toContain("Secuencia de solución verificada");
    // La última mutación ya lo decía: el validador incremental quedó sin errores.
    expect(built.log.at(-1)?.text).toContain("✅ Validador sin errores.");
  });

  it("el test de solvabilidad da la misma ruta crítica que el fixture", async () => {
    const pkg = await draftPackage();
    const report = validateRoomPackage(pkg);
    const expected = validateRoomPackage(aldric);
    expect(report.ok).toBe(true);
    expect(report.solvability.map((s) => [s.playerCount, s.solvable])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, true],
    ]);
    expect(report.solvability).toEqual(expected.solvability);
    expect(report.criticalRoute).toEqual(expected.criticalRoute);
    expect(report.estimate).toEqual(expected.estimate);

    const route = report.criticalRoute!;
    expect(route.playerCount).toBe(1);
    expect(route.steps).toHaveLength(16);
    expect(route.steps.map((step) => step.subjectId)).toEqual([
      "p-llave-cuadro",
      "armario",
      "p-combina",
      "brasero",
      "p-candado-arca",
      "p-placas-estatuas",
      "bodega",
      "p-mural-vendimia",
      "p-combina",
      "p-copas-memoria",
      "barril-espejo",
      "p-reja-mirillas",
      "catacumbas",
      "p-canal-agua",
      "vasijas",
      "p-sello-final",
    ]);
    expect(route.steps.at(-1)?.victory).toBe(true);
  });

  it("el RoomPackage resultante es equivalente al fixture", async () => {
    const pkg = await draftPackage();
    expect(normalize(pkg)).toEqual(normalize(aldric));

    // Lo que la normalización deja fuera, explícito:
    expect(pkg.meta).toMatchObject({ authorId: AUTHOR.userId, version: "0.0.0" });
    expect(pkg.meta.id).toBe(built.roomId);
    // Decoración e iluminación, byte a byte y en el orden del fixture (el
    // runtime pinta la primera luz ambiente; la antorcha del salón la gobierna
    // el brasero).
    for (const [index, room] of pkg.map.rooms.entries()) {
      const expected = aldric.map.rooms[index];
      expect(room.decorations, room.id).toEqual(expected?.decorations);
      expect(room.lighting, room.id).toEqual(expected?.lighting);
    }
    expect(pkg.map.rooms[0]?.lighting).toContainEqual({
      type: "torch",
      x: 5,
      y: 1,
      objectId: "brasero",
    });
    // Las habitaciones sí conservan el orden (el primer spawn es el del salón).
    expect(pkg.map.rooms.map((room) => room.id)).toEqual(aldric.map.rooms.map((room) => room.id));
    // Desempates por posición entre reglas del mismo disparador: mismo orden.
    // (r-caliz-en-ranura antes que r-recoger-caliz: ambas al interactuar con la ranura).
    expect(Object.values(ruleTieGroups(aldric.rules))).toContainEqual([
      "r-caliz-en-ranura",
      "r-recoger-caliz",
    ]);
    expect(ruleTieGroups(pkg.rules)).toEqual(ruleTieGroups(aldric.rules));
  });

  it("get_room (la vista del agente) devuelve el mismo paquete que ve el editor", async () => {
    const result = await call(built.client, "get_room", { roomId: built.roomId });
    expect(result.isError, result.text).toBe(false);
    expect(result.structured?.room).toEqual(await draftPackage());
  });
});
