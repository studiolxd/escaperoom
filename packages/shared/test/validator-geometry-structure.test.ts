import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import { validateRoomPackage, type ValidationCheckId, type ValidationReport } from "../src/validator";

/**
 * Checks del validador que faltaban (auditoría D-3, D-10): geometría fuera de
 * la rejilla de una habitación, referencias en `dialog.conditions`,
 * `defaultLanguage ∈ languages`, `players.min ≤ max`, `object.initialState ∈
 * states`, cupo de `spawnPoints`, símbolos únicos en `memory` y longitud de
 * `code_lock.code`. Antes fallaban en silencio (loader, runtime) o solo los
 * comprobaba `create_room` (MCP).
 */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

function cloneFixture(): RoomPackage {
  return structuredClone(reyAldric);
}

function checkOf(report: ValidationReport, id: ValidationCheckId) {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (!check) throw new Error(`falta el check ${id}`);
  return check;
}

describe("validador — Rey Aldric pasa limpio los checks nuevos", () => {
  it("geometry, structure y spawn_capacity están en verde", () => {
    const report = validateRoomPackage(reyAldric);
    expect(checkOf(report, "geometry").status).toBe("ok");
    expect(checkOf(report, "structure").status).toBe("ok");
    expect(checkOf(report, "spawn_capacity").status).toBe("ok");
  });
});

describe("validador — geometría (D-3)", () => {
  it("un objeto fuera de la rejilla de su habitación es un error", () => {
    const pkg = cloneFixture();
    const room = pkg.map.rooms[0]!;
    const object = pkg.objects.find((o) => o.roomId === room.id)!;
    object.position = { x: room.grid.cols + 5, y: 0 };
    const report = validateRoomPackage(pkg);
    const check = checkOf(report, "geometry");
    expect(check.status).toBe("error");
    expect(check.issues.some((issue) => issue.ids.includes(object.id))).toBe(true);
  });

  it("un spawnPoint fuera de la rejilla es un error", () => {
    const pkg = cloneFixture();
    const room = pkg.map.rooms[0]!;
    room.spawnPoints.push({ id: "sp-fuera", x: -1, y: 0 });
    const check = checkOf(validateRoomPackage(pkg), "geometry");
    expect(check.status).toBe("error");
    expect(check.issues.some((issue) => issue.ids.includes("sp-fuera"))).toBe(true);
  });
});

describe("validador — referencias en dialog.conditions (D-10)", () => {
  it("un item inexistente en dialog.conditions es un error de referencias", () => {
    const pkg = cloneFixture();
    pkg.dialogs.push({
      id: "d-test-cond",
      text: { es: { text: "..." } },
      conditions: [{ type: "item_in_inventory", itemId: "no-existe" }],
    });
    const check = checkOf(validateRoomPackage(pkg), "references");
    expect(check.status).toBe("error");
    expect(
      check.issues.some(
        (issue) => issue.code === "unknown_item" && issue.ids.includes("no-existe"),
      ),
    ).toBe(true);
  });
});

describe("validador — invariantes estructurales (D-10)", () => {
  it("defaultLanguage fuera de languages es un error", () => {
    const pkg = cloneFixture();
    pkg.meta.defaultLanguage = "fr";
    const check = checkOf(validateRoomPackage(pkg), "structure");
    expect(check.status).toBe("error");
    expect(check.issues.some((issue) => issue.code === "default_language_not_declared")).toBe(
      true,
    );
  });

  it("players.min > players.max es un error", () => {
    const pkg = cloneFixture();
    pkg.meta.players = { min: 4, max: 2 };
    const check = checkOf(validateRoomPackage(pkg), "structure");
    expect(check.status).toBe("error");
    expect(check.issues.some((issue) => issue.code === "players_range_invalid")).toBe(true);
  });

  it("object.initialState fuera de sus estados declarados es un error", () => {
    const pkg = cloneFixture();
    const object = pkg.objects.find((o) => Object.keys(o.states).length > 0)!;
    object.initialState = "estado-inventado";
    const check = checkOf(validateRoomPackage(pkg), "structure");
    expect(check.status).toBe("error");
    expect(check.issues.some((issue) => issue.code === "unknown_initial_state")).toBe(true);
  });

  it("un objeto sin máquina de estados (states: {}) no dispara el check", () => {
    const pkg = cloneFixture();
    const decorative = pkg.objects.find((o) => Object.keys(o.states).length === 0);
    expect(decorative).toBeDefined();
    const check = checkOf(validateRoomPackage(pkg), "structure");
    expect(check.issues.some((issue) => issue.ids.includes(decorative!.id))).toBe(false);
  });

  it("símbolos repetidos en memory son un error", () => {
    const pkg = cloneFixture();
    const memory = pkg.puzzles.find((p) => p.type === "memory" && p.pairs.length >= 2);
    if (memory && memory.type === "memory") {
      memory.pairs[1]!.symbol = memory.pairs[0]!.symbol;
      const check = checkOf(validateRoomPackage(pkg), "structure");
      expect(check.status).toBe("error");
      expect(check.issues.some((issue) => issue.code === "duplicate_memory_symbol")).toBe(true);
    }
  });

  it("code_lock.code con longitud distinta de length es un error", () => {
    const pkg = cloneFixture();
    const lock = pkg.puzzles.find((p) => p.type === "code_lock");
    if (lock && lock.type === "code_lock") {
      lock.code = "1";
      lock.length = 4;
      const check = checkOf(validateRoomPackage(pkg), "structure");
      expect(check.status).toBe("error");
      expect(check.issues.some((issue) => issue.code === "code_length_mismatch")).toBe(true);
    }
  });
});

describe("validador — cupo de spawnPoints (D-10)", () => {
  it("menos spawnPoints que players.max es un aviso, no un error", () => {
    const pkg = cloneFixture();
    pkg.meta.players = { min: 1, max: 10 };
    const check = checkOf(validateRoomPackage(pkg), "spawn_capacity");
    expect(check.status).toBe("warning");
    expect(check.issues.length).toBeGreaterThan(0);
  });
});
