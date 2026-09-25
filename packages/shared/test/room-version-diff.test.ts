import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage, type Rule, type RoomPackage } from "../src/schemas";
import { classifyRoomPackageChange } from "../src/services/room-version-diff";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
const clone = (): RoomPackage => structuredClone(reyAldric);

/** Regla mínima válida, para no depender de una plantilla concreta del fixture. */
function makeRule(overrides: Partial<Rule> & Pick<Rule, "id">): Rule {
  return {
    priority: 0,
    once: true,
    trigger: { type: "on_game_start" },
    conditions: [],
    actions: [],
    ...overrides,
  };
}

describe("classifyRoomPackageChange (ADR-035)", () => {
  it("primera publicación (previous null) → 'major' (nextSemver la fija a 1.0.0 sin llamar aquí)", () => {
    expect(classifyRoomPackageChange(null, clone())).toBe("major");
  });

  it("paquetes idénticos → 'none'", () => {
    expect(classifyRoomPackageChange(clone(), clone())).toBe("none");
  });

  it("solo cambia meta.id/meta.authorId/meta.version (lo fija el servidor al congelar) → 'none'", () => {
    const previous = clone();
    const candidate = clone();
    candidate.meta.id = "otra-sala";
    candidate.meta.authorId = "otro-autor";
    candidate.meta.version = "9.9.9";
    expect(classifyRoomPackageChange(previous, candidate)).toBe("none");
  });

  it("añadir un puzzle → 'major'", () => {
    const previous = clone();
    const candidate = clone();
    candidate.puzzles.push({
      ...candidate.puzzles.find((p) => p.type === "hidden_key")!,
      id: "p-nuevo",
    });
    expect(classifyRoomPackageChange(previous, candidate)).toBe("major");
  });

  it("eliminar un puzzle → 'major'", () => {
    const previous = clone();
    const candidate = clone();
    candidate.puzzles = candidate.puzzles.filter((p) => p.id !== "p-canal-agua");
    expect(classifyRoomPackageChange(previous, candidate)).toBe("major");
  });

  it("modificar el contenido de un puzzle existente (mismo id) → 'minor'", () => {
    const previous = clone();
    const candidate = clone();
    const lock = candidate.puzzles.find((p) => p.id === "p-sello-final");
    if (!lock || lock.type !== "code_lock") throw new Error("fixture sin p-sello-final");
    lock.code = "9999";
    expect(classifyRoomPackageChange(previous, candidate)).toBe("minor");
  });

  it("añadir una regla que referencia un puzzleId presente en ambas versiones → 'minor'", () => {
    const previous = clone();
    const candidate = clone();
    candidate.rules.push(
      makeRule({
        id: "r-nueva",
        trigger: { type: "on_puzzle_solved", puzzleId: "p-canal-agua" },
        actions: [{ type: "play_sound", soundId: "fanfarria" }],
      }),
    );
    expect(classifyRoomPackageChange(previous, candidate)).toBe("minor");
  });

  it("eliminar una regla que referencia (en una condición) un puzzleId presente en ambas versiones → 'minor'", () => {
    const previous = clone();
    previous.rules.push(
      makeRule({
        id: "r-a-quitar",
        conditions: [{ type: "puzzle_state_is", puzzleId: "p-canal-agua", state: "solved" }],
      }),
    );
    const candidate = clone();
    expect(classifyRoomPackageChange(previous, candidate)).toBe("minor");
  });

  it("modificar una regla que apunta (en una acción) a un puzzle existente sin tocar el puzzle en sí → 'minor'", () => {
    const previous = clone();
    previous.rules.push(
      makeRule({
        id: "r-panel",
        actions: [{ type: "open_panel_puzzle", puzzleId: "p-canal-agua" }],
      }),
    );
    const candidate = clone();
    candidate.rules.push(
      makeRule({
        id: "r-panel",
        actions: [{ type: "open_panel_puzzle", puzzleId: "p-canal-agua" }],
        priority: 5,
      }),
    );
    expect(classifyRoomPackageChange(previous, candidate)).toBe("minor");
  });

  it("una regla dentro de un `delay` que referencia un puzzleId también cuenta como 'minor'", () => {
    const previous = clone();
    const candidate = clone();
    candidate.rules.push(
      makeRule({
        id: "r-delay",
        actions: [
          {
            type: "delay",
            seconds: 1,
            actions: [{ type: "open_panel_puzzle", puzzleId: "p-canal-agua" }],
          },
        ],
      }),
    );
    expect(classifyRoomPackageChange(previous, candidate)).toBe("minor");
  });

  it("añadir/quitar/modificar una regla que no referencia ningún puzzleId → 'patch'", () => {
    const previous = clone();
    const candidate = clone();
    candidate.rules.push(
      makeRule({
        id: "r-decorativa",
        trigger: { type: "on_interact", objectId: "cofre-decorativo" },
        actions: [{ type: "set_flag", flag: "cofre_abierto", value: true }],
      }),
    );
    expect(classifyRoomPackageChange(previous, candidate)).toBe("patch");
  });

  it("reordenar puzzles/reglas sin añadir, quitar ni modificar contenido → 'none'", () => {
    const previous = clone();
    const candidate = clone();
    candidate.puzzles = [...candidate.puzzles].reverse();
    candidate.rules = [...candidate.rules].reverse();
    expect(classifyRoomPackageChange(previous, candidate)).toBe("none");
  });

  it("un cambio fuera de puzzles[]/rules[] (objects, map, dialogs, meta.assetsManifest…) → 'patch'", () => {
    const previous = clone();
    const candidate = clone();
    candidate.meta.assetsManifest = "r2://assets/packs/medieval-v2/manifest.json";
    expect(classifyRoomPackageChange(previous, candidate)).toBe("patch");

    const candidate2 = clone();
    candidate2.dialogs[0]!.text.es!.text = "Otro texto de diálogo";
    expect(classifyRoomPackageChange(previous, candidate2)).toBe("patch");
  });
});
