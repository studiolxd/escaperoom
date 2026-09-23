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
import { createCreatorMcpServer, DraftSnapshotCache, type CreatorMcpDeps } from "../src";
import { call, errorCode } from "./fixtures/client";
import { ALDRIC_ROOM_ID, AUTHOR, loadAldric } from "./fixtures/drafts";
import { CRYPT, buildSmallRoom } from "./fixtures/small-room";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const aldric = parseRoomPackage(loadAldric());
const roomId = ALDRIC_ROOM_ID;

/**
 * Servicios en memoria con la conversión real de 3.1 y una caché de fotos
 * propia (para medirla). `seed` = RoomPackage con el que se siembra el draft
 * del Aldric (por defecto, el de referencia, en verde).
 */
async function createDeps(seed?: RoomPackage) {
  const store = createInMemoryRoomDraftStore([{ id: ALDRIC_ROOM_ID, authorId: AUTHOR.userId }]);
  const drafts = createRoomDraftService({ store });
  const doc = roomPackageToDoc(seed ?? aldric);
  await drafts.appendUpdate(AUTHOR, ALDRIC_ROOM_ID, Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const snapshotCache = new DraftSnapshotCache();
  const deps: CreatorMcpDeps = {
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts,
    actor: AUTHOR,
    roomDocToPackage,
    snapshotCache,
  };
  return { deps, drafts, store, snapshotCache };
}

async function connect(deps: CreatorMcpDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-4.4-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

async function draftPackage(drafts: RoomDraftService, id = roomId): Promise<RoomPackage> {
  const doc = buildDraftDoc(await drafts.loadDraft(AUTHOR, id));
  try {
    return roomDocToPackage(doc);
  } finally {
    doc.destroy();
  }
}

/** El escondite del cuadro sin entregar la llave: dead end (armario, antorcha…). */
function brokenHiddenKey() {
  const puzzle = structuredClone(aldric.puzzles.find((p) => p.id === "p-llave-cuadro")!);
  puzzle.grantsItems = [];
  return puzzle;
}

type ErrorDetails = {
  code: string;
  reason?: string;
  available?: string[];
  introducedErrors?: Array<{ check: string; code: string; ids: string[] }>;
  report?: { ok: boolean; checks: Array<{ id: string; status: string }> };
  preexistingErrors?: number;
  dryRun?: boolean;
};
const details = (result: { structured?: Record<string, unknown> }) =>
  result.structured?.error as ErrorDetails;

describe("pipeline de mutación con dry-run y validador incremental (4.4)", () => {
  it("add_rule con un objeto inexistente lista los objetos disponibles y no escribe", async () => {
    const { deps, drafts, store } = await createDeps();
    const client = await connect(deps);
    const before = await draftPackage(drafts);
    const updates = await store.countUpdatesAfter(roomId, 0n);

    const result = await call(client, "add_rule", {
      roomId,
      rule: {
        trigger: { type: "on_interact", objectId: "salida-bodega" },
        conditions: [],
        actions: [{ type: "show_dialog", dialogId: "d-cuadro" }],
      },
    });
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("NOT_FOUND");
    expect(result.text).toMatch(
      /^❌ add_rule: No existe el objeto "salida-bodega" \(en trigger\.objectId\)\. Objetos disponibles: \[trono, cuadro-aurelio, /,
    );
    expect(details(result).available).toEqual(aldric.objects.map((object) => object.id));
    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(updates);
    expect(await draftPackage(drafts)).toEqual(before);
  });

  it("una mutación que introduce un dead end nuevo se rechaza con el informe y el doc queda intacto", async () => {
    const { deps, drafts, store } = await createDeps();
    const client = await connect(deps);
    const before = await draftPackage(drafts);
    const updates = await store.countUpdatesAfter(roomId, 0n);

    const result = await call(client, "add_puzzle", {
      roomId,
      puzzle: brokenHiddenKey(),
      replace: true,
    });
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("VALIDATION_FAILED");
    const error = details(result);
    expect(error.reason).toBe("VALIDATION_REGRESSION");
    expect(error.introducedErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "dead_ends", code: "dead_end", ids: ["p-llave-cuadro"] }),
      ]),
    );
    expect(error.report?.ok).toBe(false);
    expect(error.report?.checks.find((check) => check.id === "dead_ends")?.status).toBe("error");
    expect(error.preexistingErrors).toBe(0);

    // Mensaje accionable: qué falla, qué hacer e informe resumido.
    expect(result.text).toMatch(
      /^❌ add_puzzle: mutación rechazada, no se ha escrito nada en el draft\. Introduce \d+ error\(es\) nuevo\(s\) en el validador:/,
    );
    expect(result.text).toContain(
      "[dead_ends] el puzzle «p-llave-cuadro» no puede resolverse: el escondite no entrega ningún objeto",
    );
    expect(result.text).toContain("Qué hacer:");
    expect(result.text).toContain("Informe resumido tras la mutación:");
    expect(result.text).toContain("❌ Dead ends:");

    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(updates);
    expect(await draftPackage(drafts)).toEqual(before);
  });

  it("dryRun: true devuelve el resultado sin cambiar el doc", async () => {
    const { deps, drafts, store } = await createDeps();
    const client = await connect(deps);
    const before = await draftPackage(drafts);
    const updates = await store.countUpdatesAfter(roomId, 0n);

    // Mutación válida: se valida y se describe, pero no se escribe.
    const ok = await call(client, "add_dialog", {
      roomId,
      dialog: { id: "d-ensayo", text: { es: { text: "Ensayo" } } },
      dryRun: true,
    });
    expect(ok.isError, ok.text).toBe(false);
    expect(ok.text).toMatch(/^🧪 add_dialog \(dry-run\) — "d-ensayo" añadido/);
    expect(ok.text).toContain("🧪 dryRun: true — no se ha escrito nada en el draft.");
    expect(ok.structured).toMatchObject({
      roomId,
      id: "d-ensayo",
      dryRun: true,
      validation: { status: "validated", ok: true },
    });

    // Mutación que empeora el draft: el mismo error que sin dryRun, marcado como ensayo.
    const bad = await call(client, "add_puzzle", {
      roomId,
      puzzle: brokenHiddenKey(),
      replace: true,
      dryRun: true,
    });
    expect(bad.isError).toBe(true);
    expect(errorCode(bad)).toBe("VALIDATION_FAILED");
    expect(details(bad).dryRun).toBe(true);
    expect(bad.text).toMatch(/^❌ add_puzzle: \(dry-run\) la mutación se rechazaría\./);

    // create_room en ensayo no da de alta ninguna sala.
    const created = await call(client, "create_room", {
      meta: {
        title: "Ensayo",
        theme: "medieval",
        languages: ["es"],
        defaultLanguage: "es",
        difficulty: 1,
        players: { min: 1, max: 2 },
      },
      dryRun: true,
    });
    expect(created.isError, created.text).toBe(false);
    expect(created.text).toMatch(/^🧪 create_room \(dry-run\)/);
    expect(created.structured).toEqual({ dryRun: true });

    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(updates);
    expect(await draftPackage(drafts)).toEqual(before);

    // El ensayo válido se puede confirmar después tal cual.
    const real = await call(client, "add_dialog", {
      roomId,
      dialog: { id: "d-ensayo", text: { es: { text: "Ensayo" } } },
    });
    expect(real.text).toMatch(/^✅ add_dialog — "d-ensayo" añadido/);
    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(updates + 1);
  });

  it("sobre un draft con errores previos, una mutación que no los empeora se acepta", async () => {
    // Draft a medio construir: el escondite ya no entrega la llave (dead ends previos).
    const seed = structuredClone(aldric);
    seed.puzzles = seed.puzzles.map((p) => (p.id === "p-llave-cuadro" ? brokenHiddenKey() : p));
    const { deps, drafts, store } = await createDeps(seed);
    const client = await connect(deps);
    const updates = await store.countUpdatesAfter(roomId, 0n);

    const dialog = await call(client, "add_dialog", {
      roomId,
      dialog: { id: "d-nota", text: { es: { text: "Una nota" } } },
    });
    expect(dialog.isError, dialog.text).toBe(false);
    expect(dialog.text).toMatch(/^✅ add_dialog — "d-nota" añadido/);
    expect(dialog.text).toMatch(
      /ℹ️ El draft sigue con \d+ error\(es\) pendiente\(s\) \(no bloquean esta mutación\):/,
    );
    const validation = dialog.structured?.validation as {
      ok: boolean;
      pendingErrors: Array<{ check: string; ids: string[] }>;
    };
    expect(validation.ok).toBe(false);
    expect(validation.pendingErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "dead_ends", ids: ["p-llave-cuadro"] }),
      ]),
    );

    // Una regla nueva que no toca lo roto también pasa.
    const rule = await call(client, "add_rule", {
      roomId,
      rule: {
        trigger: { type: "on_interact", objectId: "trono" },
        conditions: [],
        actions: [{ type: "show_dialog", dialogId: "d-nota" }],
      },
    });
    expect(rule.isError, rule.text).toBe(false);
    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(updates + 2);

    // …pero un dead end NUEVO sigue rechazándose aunque ya hubiera otros.
    const door = await call(client, "add_object", {
      roomId,
      object: {
        id: "puerta-secreta",
        roomId: "salon-trono",
        type: "puerta",
        position: { x: 1, y: 1 },
        sprite: "puerta-madera",
        states: { closed: "puerta-cerrada", open: "puerta-abierta" },
        initialState: "closed",
        interactable: true,
        lockedBy: "p-inexistente",
      },
    });
    expect(door.isError).toBe(true);
    expect(errorCode(door)).toBe("VALIDATION_FAILED");
    expect(details(door).preexistingErrors).toBeGreaterThan(0);
    expect(door.text).toContain("El draft ya tenía");
    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(updates + 2);

    // Y arreglar lo roto se acepta y lo resuelve.
    const fix = await call(client, "add_puzzle", {
      roomId,
      puzzle: aldric.puzzles.find((p) => p.id === "p-llave-cuadro"),
      replace: true,
    });
    expect(fix.isError, fix.text).toBe(false);
    expect(fix.text).toMatch(/✅ Resuelve \d+ error\(es\) del validador\./);
    expect(fix.structured?.validation).toMatchObject({ ok: true, pendingErrors: [] });
    expect((await draftPackage(drafts)).puzzles.find((p) => p.id === "p-llave-cuadro")).toEqual(
      aldric.puzzles.find((p) => p.id === "p-llave-cuadro"),
    );
  });

  it("construir un draft pequeño paso a paso por MCP llega al validador en verde", async () => {
    const { deps, drafts, snapshotCache } = await createDeps();
    const client = await connect(deps);
    const smallRoomId = await buildSmallRoom(client);

    // Aún sin victoria: la no-solvabilidad es el estado natural y no bloqueó nada.
    const pending = await call(client, "validate", { roomId: smallRoomId });
    expect(pending.structured?.ok).toBe(false);

    const victory = await call(client, "add_rule", {
      roomId: smallRoomId,
      rule: {
        trigger: { type: "on_enter_room", roomId: CRYPT },
        conditions: [],
        actions: [{ type: "end_game", result: "victory" }],
      },
    });
    expect(victory.isError, victory.text).toBe(false);
    expect(victory.text).toMatch(/✅ Resuelve \d+ error\(es\) del validador\./);
    expect(victory.structured?.validation).toMatchObject({ ok: true, pendingErrors: [] });

    const report = await call(client, "validate", { roomId: smallRoomId });
    expect(report.isError).toBe(false);
    expect(report.structured?.ok).toBe(true);
    expect(report.text).toContain("Secuencia de solución verificada");
    expect(report.text).not.toContain("❌");
    expect((await draftPackage(drafts, smallRoomId)).rules).toHaveLength(1);

    // Rendimiento: la foto "después" de cada commit es la "antes" del siguiente,
    // así que casi todas las llamadas serializan una sola vez (solo falla la primera).
    expect(snapshotCache.misses).toBe(1);
    expect(snapshotCache.hits).toBeGreaterThanOrEqual(10);
  });
});
