import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRoomPackage, type Rule } from "@escaperoom/shared/schemas";
import { describe, expect, it } from "vitest";
import {
  RoomDocError,
  addRule,
  proposeRuleId,
  readRules,
  roomDocToPackage,
  roomPackageToDoc,
} from "../src";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const aldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error instanceof RoomDocError ? `${error.code}: ${error.message}` : error;
  }
  return undefined;
}

const rule = (patch: Partial<Rule>): Rule => ({
  id: "r-nueva",
  priority: 0,
  once: true,
  trigger: { type: "on_game_start" },
  conditions: [],
  actions: [],
  ...patch,
});

describe("comandos de lógica (4.3) sobre el mapa rules de 3.6", () => {
  it("addRule añade la regla completa al final, con el mismo modelo que el grafo", () => {
    const doc = roomPackageToDoc(aldric);
    const added = rule({
      id: "r-estatua",
      trigger: { type: "on_interact", objectId: "estatua-izq" },
      actions: [
        { type: "delay", seconds: 2, actions: [{ type: "show_dialog", dialogId: "d-intro" }] },
      ],
    });
    expect(addRule(doc, added)).toEqual({ replaced: false });
    expect(readRules(doc).at(-1)).toEqual(added);
    expect(roomDocToPackage(doc).rules).toEqual([...aldric.rules, added]);
  });

  it("rechaza referencias inexistentes con el código de la colección y la ruta", () => {
    const doc = roomPackageToDoc(aldric);
    expect(
      codeOf(() =>
        addRule(doc, rule({ actions: [{ type: "unlock_door", objectId: "salida-bodega" }] })),
      ),
    ).toBe('UNKNOWN_OBJECT: No existe el objeto "salida-bodega" (en actions[0].objectId)');
    expect(
      codeOf(() =>
        addRule(doc, rule({ conditions: [{ type: "item_in_inventory", itemId: "copa" }] })),
      ),
    ).toBe('UNKNOWN_ITEM: No existe el item "copa" (en conditions[0].itemId)');
    expect(
      codeOf(() => addRule(doc, rule({ trigger: { type: "on_puzzle_solved", puzzleId: "p-x" } }))),
    ).toBe('UNKNOWN_PUZZLE: No existe el puzzle "p-x" (en trigger.puzzleId)');
    expect(readRules(doc)).toEqual(aldric.rules);
  });

  it("id libre en el espacio compartido; replace conserva el orden", () => {
    const doc = roomPackageToDoc(aldric);
    expect(codeOf(() => addRule(doc, rule({ id: "r-inicio" })))).toBe(
      'DUPLICATE_ID: Ya existe el id "r-inicio"',
    );
    expect(codeOf(() => addRule(doc, rule({ id: "brasero" })))).toBe(
      'DUPLICATE_ID: Ya existe el id "brasero"',
    );
    expect(codeOf(() => addRule(doc, rule({ id: "Mal Id" })))).toBe(
      'INVALID_ID: "Mal Id" no es un id válido (a-z, 0-9 y guiones)',
    );
    // replace solo sustituye reglas, nunca otra entidad con el mismo id.
    expect(codeOf(() => addRule(doc, rule({ id: "brasero" }), { replace: true }))).toBe(
      'DUPLICATE_ID: Ya existe el id "brasero"',
    );
    expect(addRule(doc, rule({ id: "r-inicio", priority: 5 }), { replace: true })).toEqual({
      replaced: true,
    });
    const rules = readRules(doc);
    expect(rules.map((r) => r.id)).toEqual(aldric.rules.map((r) => r.id));
    expect(rules[0]).toEqual(rule({ id: "r-inicio", priority: 5 }));
  });

  it("proposeRuleId deriva un id legible del trigger", () => {
    const doc = roomPackageToDoc(aldric);
    expect(proposeRuleId(doc, { type: "on_interact", objectId: "estatua-izq" })).toBe(
      "r-estatua-izq",
    );
    expect(
      proposeRuleId(doc, { type: "on_use_item", objectId: "mural-ranura", itemId: "caliz-real" }),
    ).toBe("r-caliz-real-en-mural-ranura");
    expect(proposeRuleId(doc, { type: "on_puzzle_solved", puzzleId: "p-candado-arca" })).toBe(
      "r-candado-arca-resuelto",
    );
    // `r-inicio` ya existe en el Rey Aldric.
    expect(proposeRuleId(doc, { type: "on_game_start" })).toBe("r-inicio-2");
  });
});
