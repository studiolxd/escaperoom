import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, RuleSchema, type Rule } from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  actionNodeId,
  applyGraphDeletion,
  applyIssues,
  conditionNodeId,
  connectDraft,
  createRule,
  defaultAction,
  defaultCondition,
  defaultTrigger,
  getRulesMap,
  graphToRules,
  insertAction,
  nextRuleId,
  observeRules,
  readRules,
  renameRule,
  rulesToGraph,
  triggerNodeId,
  updateAction,
  updateRule,
  writeRules,
  type RuleGraph,
  type RuleGraphNode,
} from "../src";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const roomPackage = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
const fixtureRules: Rule[] = roomPackage.rules;
const brasero = fixtureRules.find((rule) => rule.id === "r-encender-brasero");

function docWith(rules: readonly Rule[]): Y.Doc {
  const doc = new Y.Doc();
  writeRules(doc, rules);
  return doc;
}

function graphOf(doc: Y.Doc): RuleGraph {
  return rulesToGraph(readRules(doc));
}

function nodeById(graph: RuleGraph, id: string): RuleGraphNode {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Falta el nodo ${id}`);
  return node;
}

describe("grafo de reglas — ida y vuelta sin pérdida", () => {
  it("el fixture del Rey Aldric tiene reglas de todos los tamaños (incluido un delay anidado)", () => {
    expect(fixtureRules.length).toBeGreaterThanOrEqual(19);
    expect(fixtureRules.some((rule) => rule.actions.some((a) => a.type === "delay"))).toBe(true);
    expect(fixtureRules.some((rule) => rule.conditions.length >= 2)).toBe(true);
  });

  it("reglas → grafo → reglas conserva TODAS las reglas del fixture", () => {
    const graph = rulesToGraph(fixtureRules);
    expect(graphToRules(graph)).toEqual(fixtureRules);
  });

  it("reglas → doc Yjs → grafo → reglas conserva TODAS las reglas (también tras sincronizar)", () => {
    const doc = docWith(fixtureRules);
    expect(readRules(doc)).toEqual(fixtureRules);
    expect(graphToRules(graphOf(doc))).toEqual(fixtureRules);

    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    expect(graphToRules(graphOf(replica))).toEqual(fixtureRules);
    for (const rule of readRules(replica)) expect(RuleSchema.parse(rule)).toEqual(rule);
  });

  it("modela trigger → cadena de condiciones → abanico de acciones, y delay → hijas", () => {
    const graph = rulesToGraph(fixtureRules);
    const edges = new Set(graph.edges.map((e) => `${e.source}->${e.target}`));

    // r-recoger-caliz: dos condiciones en cadena y dos acciones colgando de la última.
    const t = triggerNodeId("r-recoger-caliz");
    const c0 = conditionNodeId("r-recoger-caliz", 0);
    const c1 = conditionNodeId("r-recoger-caliz", 1);
    expect(edges).toContain(`${t}->${c0}`);
    expect(edges).toContain(`${c0}->${c1}`);
    expect(edges).toContain(`${c1}->${actionNodeId("r-recoger-caliz", [0])}`);
    expect(edges).toContain(`${c1}->${actionNodeId("r-recoger-caliz", [1])}`);

    // r-sello-resuelto: el delay es origen de su end_game anidado.
    const delay = actionNodeId("r-sello-resuelto", [2]);
    expect(edges).toContain(`${delay}->${actionNodeId("r-sello-resuelto", [2, 0])}`);
    expect(nodeById(graph, delay).data).toMatchObject({ action: { type: "delay", seconds: 4 } });
    expect(nodeById(graph, delay).data).not.toHaveProperty("action.actions");

    // Maquetación: nadie se solapa.
    const positions = graph.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe("grafo de reglas — crear la regla del brasero desde cero", () => {
  it("con las operaciones del grafo produce una regla equivalente a la del fixture", () => {
    expect(brasero).toBeDefined();
    const doc = new Y.Doc();

    // 1. Nueva regla (botón de la barra): nace con un trigger por defecto y un id
    //    libre; en su nodo se renombra, se cambia el tipo y se rellena el campo.
    const ruleId = createRule(doc, { id: nextRuleId(doc), trigger: defaultTrigger("on_interact") });
    renameRule(doc, ruleId, "r-encender-brasero");
    updateRule(doc, "r-encender-brasero", {
      trigger: { ...defaultTrigger("on_interact"), objectId: "brasero" },
    });
    const triggerNode = nodeById(graphOf(doc), triggerNodeId("r-encender-brasero"));

    // 2. Borrador de condición conectado desde el trigger.
    const condition = {
      ...defaultCondition("item_in_inventory"),
      itemId: "antorcha",
      consumed: true,
    };
    expect(connectDraft(doc, triggerNode, { kind: "condition", condition })).toBe(true);

    // 3. Cuatro borradores de acción conectados desde la condición (último eslabón).
    const conditionNode = nodeById(graphOf(doc), conditionNodeId("r-encender-brasero", 0));
    const actions = [
      { ...defaultAction("set_object_state"), objectId: "brasero", state: "lit" },
      { ...defaultAction("set_flag"), flag: "digito3", value: 3 },
      { ...defaultAction("show_dialog"), dialogId: "d-brasero" },
      { ...defaultAction("play_sound"), soundId: "fx-fuego" },
    ];
    for (const action of actions) {
      expect(connectDraft(doc, conditionNode, { kind: "action", action })).toBe(true);
    }

    const [rule] = readRules(doc);
    expect(readRules(doc)).toHaveLength(1);
    expect(rule).toEqual(brasero);
    expect(RuleSchema.parse(rule)).toEqual(brasero);
    // Y la vista de grafo de la regla recreada es la misma que la del fixture.
    expect(graphOf(doc)).toEqual(rulesToGraph([brasero as Rule]));
  });

  it("rechaza conexiones que el formato no puede representar", () => {
    const doc = docWith([brasero as Rule]);
    const graph = graphOf(doc);
    const action = nodeById(graph, actionNodeId("r-encender-brasero", [0]));
    const before = readRules(doc);
    // Una condición no cuelga de una acción; una acción solo cuelga de un delay.
    expect(
      connectDraft(doc, action, { kind: "condition", condition: defaultCondition("flag_is") }),
    ).toBe(false);
    expect(connectDraft(doc, action, { kind: "action", action: defaultAction("end_game") })).toBe(
      false,
    );
    expect(readRules(doc)).toEqual(before);
  });
});

describe("grafo de reglas — el doc Yjs es la fuente de verdad", () => {
  it("una mutación directa del Y.Doc (p. ej. el MCP) se refleja en el modelo del grafo", () => {
    const editor = docWith(fixtureRules);
    const mcp = new Y.Doc();
    Y.applyUpdate(mcp, Y.encodeStateAsUpdate(editor));
    mcp.on("update", (update: Uint8Array) => Y.applyUpdate(editor, update));

    let notified = 0;
    const unsubscribe = observeRules(editor, () => (notified += 1));

    // El "MCP" toca Yjs a pelo, sin las operaciones del editor.
    const rule = getRulesMap(mcp).get("r-inspeccionar-cuadro") as Y.Map<unknown>;
    (rule.get("actions") as Y.Array<unknown>).push([{ type: "play_sound", soundId: "fx-cuadro" }]);
    rule.set("priority", 7);

    expect(notified).toBeGreaterThan(0);
    const graph = graphOf(editor);
    expect(nodeById(graph, actionNodeId("r-inspeccionar-cuadro", [2])).data).toMatchObject({
      action: { type: "play_sound", soundId: "fx-cuadro" },
    });
    expect(nodeById(graph, triggerNodeId("r-inspeccionar-cuadro")).data).toMatchObject({
      priority: 7,
    });

    // Y al revés: borrar una regla en el doc del MCP la quita del grafo del editor.
    getRulesMap(mcp).delete("r-aviso-10min");
    expect(graphOf(editor).nodes.some((n) => n.data.ruleId === "r-aviso-10min")).toBe(false);
    unsubscribe();
  });

  it("dos colaboradores añadiendo acciones a la misma regla convergen", () => {
    const a = docWith([brasero as Rule]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    insertAction(a, "r-encender-brasero", defaultAction("unlock_door"));
    insertAction(b, "r-encender-brasero", defaultAction("consume_item"));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readRules(a)).toEqual(readRules(b));
    expect(readRules(a)[0]?.actions).toHaveLength(6);
  });
});

describe("grafo de reglas — borrar y desconectar", () => {
  it("borrar el trigger borra la regla; borrar un nodo lo quita de su regla", () => {
    const doc = docWith(fixtureRules);
    const graph = graphOf(doc);
    applyGraphDeletion(doc, graph.nodes, {
      nodes: [
        { id: triggerNodeId("r-inicio") },
        { id: conditionNodeId("r-recoger-caliz", 0) },
        { id: actionNodeId("r-mural-resuelto", [0]) },
        { id: actionNodeId("r-mural-resuelto", [2]) },
      ],
    });
    const rules = readRules(doc);
    expect(rules.find((r) => r.id === "r-inicio")).toBeUndefined();
    expect(rules.find((r) => r.id === "r-recoger-caliz")?.conditions).toEqual([
      { type: "puzzle_state_is", puzzleId: "p-placas-estatuas", state: "solved" },
    ]);
    expect(rules.find((r) => r.id === "r-mural-resuelto")?.actions.map((a) => a.type)).toEqual([
      "set_object_state",
      "show_dialog",
    ]);
  });

  it("desconectar una arista devuelve la pieza como borrador y se puede reconectar", () => {
    const doc = docWith(fixtureRules);
    const graph = graphOf(doc);
    const endGame = actionNodeId("r-sello-resuelto", [2, 0]);
    const delay = actionNodeId("r-sello-resuelto", [2]);
    const edge = graph.edges.find((e) => e.target === endGame);
    expect(edge?.source).toBe(delay);

    const drafts = applyGraphDeletion(doc, graph.nodes, { edges: edge ? [edge] : [] });
    expect(drafts).toEqual([{ kind: "action", action: { type: "end_game", result: "victory" } }]);
    const sello = () => readRules(doc).find((r) => r.id === "r-sello-resuelto");
    expect(sello()?.actions[2]).toEqual({ type: "delay", seconds: 4, actions: [] });

    // Reconectar el borrador al delay restaura la regla original.
    const delayNode = nodeById(graphOf(doc), delay);
    expect(connectDraft(doc, delayNode, drafts[0]!)).toBe(true);
    expect(readRules(doc)).toEqual(fixtureRules);
  });

  it("editar un delay desde su nodo conserva sus acciones anidadas", () => {
    const doc = docWith(fixtureRules);
    updateAction(doc, "r-sello-resuelto", [2], { type: "delay", seconds: 6 });
    expect(readRules(doc).find((r) => r.id === "r-sello-resuelto")?.actions[2]).toEqual({
      type: "delay",
      seconds: 6,
      actions: [{ type: "end_game", result: "victory" }],
    });
  });
});

describe("grafo de reglas — estilos por nodo dirigidos por datos (hook del validador 3.7)", () => {
  it("marca nodos por id de nodo o por id de regla con la severidad más alta", () => {
    const { nodes } = rulesToGraph(fixtureRules);
    const styled = applyIssues(nodes, [
      { id: "r-abrir-arca", severity: "warning", message: "Sin pista" },
      { id: "r-abrir-arca", severity: "error", message: "Dead end" },
      { id: actionNodeId("r-encender-brasero", [2]), severity: "info" },
    ]);
    const arca = nodeById({ nodes: styled, edges: [] }, triggerNodeId("r-abrir-arca"));
    expect(arca.data.severity).toBe("error");
    expect(arca.data.messages).toEqual(["Sin pista", "Dead end"]);
    expect(arca.className).toContain("rules-graph-node--error");
    expect(
      nodeById({ nodes: styled, edges: [] }, actionNodeId("r-encender-brasero", [2])).data.severity,
    ).toBe("info");
    expect(styled.filter((n) => n.data.severity).length).toBe(2);
  });
});
