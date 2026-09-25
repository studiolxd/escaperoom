import { roomDocToPackage, roomPackageToDoc } from "@escaperoom/editor/room-doc";
import { parseRoomPackage, type RoomPackage, type Rule } from "@escaperoom/shared/schemas";
import {
  buildDraftDoc,
  createCatalogService,
  createInMemoryRoomDraftStore,
  createInMemoryRoomPackageRepository,
  createRoomDraftService,
  type Actor,
  type RoomDraftService,
} from "@escaperoom/shared/services";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CREATOR_TOOLSET,
  createCreatorMcpServer,
  type CreatorMcpDeps,
  type RoomGraph,
} from "../src";
import { call, errorCode } from "./fixtures/client";
import { ALDRIC_ROOM_ID, AUTHOR, loadAldric } from "./fixtures/drafts";

const OTHER: Actor = { userId: "otra-persona", organizationId: null, role: "member" };

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const aldric = parseRoomPackage(loadAldric());

/** Draft del Rey Aldric sembrado con la serialización real de 3.1 (`roomPackageToDoc`). */
async function createAldricDeps(extra: Partial<CreatorMcpDeps> = {}) {
  const store = createInMemoryRoomDraftStore([{ id: ALDRIC_ROOM_ID, authorId: AUTHOR.userId }]);
  const drafts = createRoomDraftService({ store });
  const doc = roomPackageToDoc(aldric);
  await drafts.appendUpdate(AUTHOR, ALDRIC_ROOM_ID, Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const deps: CreatorMcpDeps = {
    catalog: createCatalogService({ rooms: createInMemoryRoomPackageRepository(loadAldric()) }),
    drafts,
    actor: AUTHOR,
    roomDocToPackage,
    ...extra,
  };
  return { deps, drafts, store };
}

async function connect(deps: CreatorMcpDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createCreatorMcpServer(deps);
  const client = new Client({ name: "mcp-4.3-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

async function draftPackage(drafts: RoomDraftService): Promise<RoomPackage> {
  const doc = buildDraftDoc(await drafts.loadDraft(AUTHOR, ALDRIC_ROOM_ID));
  try {
    return roomDocToPackage(doc);
  } finally {
    doc.destroy();
  }
}

const roomId = ALDRIC_ROOM_ID;

/** Regla nueva y válida: al tocar la estatua con las placas resueltas, un diálogo. */
const STATUE_RULE = {
  trigger: { type: "on_interact", objectId: "estatua-izq" },
  conditions: [{ type: "puzzle_state_is", puzzleId: "p-placas-estatuas", state: "solved" }],
  actions: [{ type: "show_dialog", dialogId: "d-cuadro" }],
};

describe("toolset de lógica y consulta (4.3)", () => {
  it("implementa add_rule, get_room_graph y las vistas filtradas", () => {
    const implemented = CREATOR_TOOLSET.filter((tool) => tool.run && tool.ticket === "4.3");
    expect(implemented.map((tool) => tool.name)).toEqual([
      "add_rule",
      "get_room_graph",
      "get_puzzle",
      "get_rules_for",
    ]);
  });

  it("el agente obtiene el grafo del Rey Aldric y añade una regla válida", async () => {
    const { deps, drafts } = await createAldricDeps();
    const client = await connect(deps);

    // 1. Grafo compacto para razonar.
    const graphCall = await call(client, "get_room_graph", { roomId });
    expect(graphCall.isError, graphCall.text).toBe(false);
    const graph = graphCall.structured?.graph as RoomGraph;
    expect(JSON.parse(graphCall.text)).toEqual(graph);
    expect(graph.rooms).toEqual(["salon-trono", "bodega", "catacumbas"]);
    expect(graph.objects).toHaveLength(aldric.objects.length);
    expect(graph.puzzles).toHaveLength(aldric.puzzles.length);
    expect(graph.rules.map((rule) => rule.id)).toEqual(aldric.rules.map((rule) => rule.id));
    expect(graph.rules.find((rule) => rule.id === "r-encender-brasero")).toEqual({
      id: "r-encender-brasero",
      when: "on_interact(objectId=brasero)",
      if: ["item_in_inventory(itemId=antorcha, consumed=true)"],
      then: [
        "set_object_state(objectId=brasero, state=lit)",
        "set_flag(flag=digito3, value=3)",
        "show_dialog(dialogId=d-brasero)",
        "play_sound(soundId=fx-fuego)",
      ],
    });
    expect(graph.puzzles.find((puzzle) => puzzle.id === "p-combina")).toMatchObject({
      type: "combine_items",
      recipes: ["yesquero+vela→antorcha", "llave-plata→llave-oro"],
    });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        ["brasero", "dispara", "r-encender-brasero"],
        ["antorcha", "condiciona", "r-encender-brasero"],
        ["r-encender-brasero", "afecta", "brasero"],
        ["p-placas-estatuas", "desbloquea", "puerta-bodega"],
        ["puerta-bodega", "lleva_a", "bodega"],
      ]),
    );
    // La estatua aún no tiene reglas.
    expect(graph.edges.some((edge) => edge.includes("estatua-izq") && edge[1] === "dispara")).toBe(
      false,
    );

    // 2. Añade la regla (sin id: se propone a partir del trigger).
    const added = await call(client, "add_rule", { roomId, rule: STATUE_RULE });
    expect(added.isError, added.text).toBe(false);
    // El validador incremental (4.4) acompaña al texto: el Aldric sigue en verde.
    expect(added.text).toBe(
      '✅ add_rule — "r-estatua-izq" añadida (on_interact, 1 condición(es), 1 acción(es))\n✅ Validador sin errores.',
    );
    expect(added.structured).toMatchObject({ roomId, id: "r-estatua-izq", replaced: false });
    expect(added.structured?.validation).toMatchObject({ status: "validated", ok: true });

    const expected: Rule = { id: "r-estatua-izq", priority: 0, once: true, ...STATUE_RULE } as Rule;

    // 3. Aparece en get_rules_for…
    const forStatue = await call(client, "get_rules_for", { roomId, objectId: "estatua-izq" });
    expect(forStatue.structured).toEqual({ objectId: "estatua-izq", rules: [expected] });

    // …en el RoomPackage del draft (mismo modelo `rules` que el grafo de 3.6), al final…
    const pkg = await draftPackage(drafts);
    expect(pkg.rules).toEqual([...aldric.rules, expected]);

    // …en get_room y en el grafo.
    const room = await call(client, "get_room", { roomId });
    expect((room.structured?.room as RoomPackage).rules.at(-1)).toEqual(expected);
    const after = (await call(client, "get_room_graph", { roomId })).structured?.graph as RoomGraph;
    expect(after.edges).toEqual(
      expect.arrayContaining([
        ["estatua-izq", "dispara", "r-estatua-izq"],
        ["p-placas-estatuas", "condiciona", "r-estatua-izq"],
        ["r-estatua-izq", "afecta", "d-cuadro"],
      ]),
    );

    // La sala sigue validando (validador de 2.9 sobre el draft).
    const validation = await call(client, "validate", { roomId, playerCounts: [4] });
    expect(validation.structured?.ok, validation.text).toBe(true);
  });

  it("un id repetido sugiere replace, que sustituye la regla conservando su orden", async () => {
    const { deps, drafts } = await createAldricDeps();
    const client = await connect(deps);
    const rule = { id: "r-inicio", priority: 100, ...STATUE_RULE };

    const duplicate = await call(client, "add_rule", { roomId, rule });
    expect(errorCode(duplicate)).toBe("INVALID_INPUT");
    expect(duplicate.text).toBe(
      '❌ add_rule: Ya existe el id "r-inicio". Usa otro id o `replace: true` para sustituir la entrada',
    );
    // El espacio de ids es compartido con objetos, puzzles, items y habitaciones.
    const clash = await call(client, "add_rule", { roomId, rule: { ...rule, id: "trono" } });
    expect(clash.text).toContain('Ya existe el id "trono"');

    const replaced = await call(client, "add_rule", { roomId, rule, replace: true });
    expect(replaced.structured?.replaced).toBe(true);
    const pkg = await draftPackage(drafts);
    expect(pkg.rules.map((r) => r.id)).toEqual(aldric.rules.map((r) => r.id));
    expect(pkg.rules[0]).toEqual({ ...rule, once: true });

    // Un segundo id propuesto para el mismo trigger lleva sufijo.
    await call(client, "add_rule", { roomId, rule: STATUE_RULE });
    const again = await call(client, "add_rule", { roomId, rule: STATUE_RULE });
    expect(again.structured?.id).toBe("r-estatua-izq-2");
  });

  it("todas las reglas del Rey Aldric pasan la comprobación de referencias", async () => {
    const { deps } = await createAldricDeps();
    const client = await connect(deps);
    for (const rule of aldric.rules) {
      const result = await call(client, "add_rule", { roomId, rule, replace: true });
      expect(result.isError, `${rule.id}: ${result.text}`).toBe(false);
    }
    // Una llamada por regla, cada una con el validador incremental de 4.4: margen para CI.
  }, 30_000);

  it("vistas filtradas: get_puzzle con sus pistas y reglas", async () => {
    const { deps } = await createAldricDeps();
    const client = await connect(deps);
    const result = await call(client, "get_puzzle", { roomId, puzzleId: "p-candado-arca" });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual(result.structured);
    expect(result.structured?.puzzle).toEqual(
      aldric.puzzles.find((puzzle) => puzzle.id === "p-candado-arca"),
    );
    expect((result.structured?.hints as Array<{ id: string }>).map((hint) => hint.id)).toEqual([
      "hint-arca-1",
      "hint-arca-2",
    ]);
    expect((result.structured?.rules as Rule[]).map((rule) => rule.id)).toEqual(["r-abrir-arca"]);
  });

  it("las vistas filtradas y el grafo ocupan menos que get_room", async () => {
    const { deps } = await createAldricDeps();
    const client = await connect(deps);
    const room = await call(client, "get_room", { roomId });
    const views = [
      await call(client, "get_puzzle", { roomId, puzzleId: "p-sello-final" }),
      await call(client, "get_rules_for", { roomId, objectId: "brasero" }),
      await call(client, "get_room_graph", { roomId }),
    ];
    for (const view of views) {
      expect(view.isError, view.text).toBe(false);
      expect(view.text.length).toBeLessThan(room.text.length);
    }
    // Las vistas por entidad, muy por debajo (< 10 % de la sala completa).
    expect(views[0]!.text.length).toBeLessThan(room.text.length * 0.1);
    expect(views[1]!.text.length).toBeLessThan(room.text.length * 0.1);
  });
});

describe("errores accionables (specs/10 §3)", () => {
  it("add_rule con un objeto inexistente lista los objetos disponibles y no escribe", async () => {
    const { deps, store } = await createAldricDeps();
    const client = await connect(deps);
    const before = await store.countUpdatesAfter(roomId, 0n);

    const result = await call(client, "add_rule", {
      roomId,
      rule: {
        trigger: { type: "on_puzzle_solved", puzzleId: "p-placas-estatuas" },
        conditions: [],
        actions: [{ type: "unlock_door", objectId: "salida-bodega" }],
      },
    });
    const objects = aldric.objects.map((object) => object.id);
    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("NOT_FOUND");
    expect(result.text).toBe(
      `❌ add_rule: No existe el objeto "salida-bodega" (en actions[0].objectId). Objetos disponibles: [${objects.join(", ")}]`,
    );
    expect(result.structured?.error).toMatchObject({
      reason: "UNKNOWN_OBJECT",
      available: objects,
    });
    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(before);
  });

  it("items, diálogos, puzzles y habitaciones inexistentes, también dentro de un delay", async () => {
    const { deps } = await createAldricDeps();
    const client = await connect(deps);
    const add = (rule: Record<string, unknown>) =>
      call(client, "add_rule", { roomId, rule: { conditions: [], actions: [], ...rule } });

    const item = await add({ trigger: { type: "on_item_collected", itemId: "copa" } });
    expect(item.text).toMatch(
      /^❌ add_rule: No existe el item "copa" \(en trigger\.itemId\)\. Items disponibles: \[yesquero, vela,/,
    );

    const dialog = await add({
      trigger: { type: "on_game_start" },
      actions: [
        { type: "delay", seconds: 5, actions: [{ type: "show_dialog", dialogId: "d-nada" }] },
      ],
    });
    expect(dialog.text).toContain(
      'No existe el diálogo "d-nada" (en actions[0].actions[0].dialogId). Diálogos disponibles: [d-intro,',
    );
    expect(dialog.structured?.error).toMatchObject({ reason: "UNKNOWN_DIALOG" });

    const puzzle = await add({
      trigger: { type: "on_game_start" },
      conditions: [{ type: "puzzle_state_is", puzzleId: "p-nada", state: "solved" }],
    });
    expect(puzzle.text).toContain(
      `Puzzles disponibles: [${aldric.puzzles.map((p) => p.id).join(", ")}]`,
    );

    const room = await add({ trigger: { type: "on_enter_room", roomId: "torre" } });
    expect(room.text).toContain(
      'No existe la habitación "torre" (en trigger.roomId). Habitaciones disponibles: [salon-trono, bodega, catacumbas]',
    );
  });

  it("get_puzzle y get_rules_for de un id inexistente listan los disponibles", async () => {
    const { deps } = await createAldricDeps();
    const client = await connect(deps);

    const puzzle = await call(client, "get_puzzle", { roomId, puzzleId: "p-nada" });
    expect(errorCode(puzzle)).toBe("NOT_FOUND");
    expect(puzzle.text).toBe(
      `❌ get_puzzle: No existe el puzzle "p-nada". Puzzles disponibles: [${aldric.puzzles.map((p) => p.id).join(", ")}]`,
    );

    const rules = await call(client, "get_rules_for", { roomId, objectId: "nada" });
    expect(errorCode(rules)).toBe("NOT_FOUND");
    expect(rules.structured?.error).toMatchObject({
      reason: "UNKNOWN_OBJECT",
      available: aldric.objects.map((object) => object.id),
    });
  });

  it("la entrada de add_rule se valida con el esquema Zod compartido", async () => {
    const { deps } = await createAldricDeps();
    const client = await connect(deps);
    const result = await call(client, "add_rule", {
      roomId,
      rule: { trigger: { type: "on_magic" }, conditions: [], actions: [] },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/validation/i);
  });

  it("el enganche previo al commit (4.4) ve add_rule y puede rechazarlo", async () => {
    const { deps, store } = await createAldricDeps();
    const seen: string[] = [];
    const client = await connect({
      ...deps,
      beforeCommit: ({ tool, doc }) => {
        seen.push(tool);
        if (roomDocToPackage(doc).rules.length > aldric.rules.length) {
          throw new Error("rechazada");
        }
      },
    });
    const before = await store.countUpdatesAfter(roomId, 0n);
    const result = await call(client, "add_rule", { roomId, rule: STATUE_RULE });
    expect(result.isError).toBe(true);
    expect(seen).toEqual(["add_rule"]);
    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(before);
  });
});

describe("auth: solo drafts propios", () => {
  it("otro creador no puede leer ni escribir la lógica del draft", async () => {
    const { deps, store } = await createAldricDeps();
    const intruder = await connect({ ...deps, actor: OTHER });
    const before = await store.countUpdatesAfter(roomId, 0n);
    const calls: Array<[string, Record<string, unknown>]> = [
      ["add_rule", { roomId, rule: STATUE_RULE }],
      ["get_room_graph", { roomId }],
      ["get_puzzle", { roomId, puzzleId: "p-combina" }],
      ["get_rules_for", { roomId, objectId: "trono" }],
    ];
    for (const [name, args] of calls) {
      const result = await call(intruder, name, args);
      expect(errorCode(result), name).toBe("FORBIDDEN");
    }
    expect(await store.countUpdatesAfter(roomId, 0n)).toBe(before);
  });
});
