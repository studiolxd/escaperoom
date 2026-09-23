import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import {
  compareValidationReports,
  findingKey,
  validateRoomPackage,
  validationFindings,
} from "../src/validator";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const reyAldric = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

function cloneFixture(): RoomPackage {
  return structuredClone(reyAldric);
}

/** Aldric sin la regla de victoria: un draft "a medio construir" (sin solvabilidad). */
function withoutVictory(pkg: RoomPackage): RoomPackage {
  pkg.rules = pkg.rules.filter((rule) => !JSON.stringify(rule.actions).includes('"victory"'));
  return pkg;
}

describe("validador incremental — compareValidationReports (4.4)", () => {
  it("un informe comparado consigo mismo no introduce ni resuelve nada", () => {
    const report = validateRoomPackage(cloneFixture());
    const delta = compareValidationReports(report, report);
    expect(delta).toMatchObject({
      introducedErrors: [],
      resolvedErrors: [],
      introducedWarnings: [],
      resolvedWarnings: [],
      lostSolvability: [],
      worsened: false,
    });
  });

  it("aplana los hallazgos ❌/🟡 con una huella estable (ids ordenados, sin el texto)", () => {
    const pkg = cloneFixture();
    pkg.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = [];
    const findings = validationFindings(validateRoomPackage(pkg));
    const deadEnd = findings.find((f) => f.check === "dead_ends" && f.ids[0] === "p-llave-cuadro");
    expect(deadEnd).toMatchObject({
      severity: "error",
      code: "dead_end",
      key: "dead_ends|dead_end|p-llave-cuadro",
    });
    expect(findingKey("x", "c", ["b", "a"])).toBe("x|c|a,b");
    // Los checks en ✅ no aportan hallazgos.
    expect(findings.every((f) => f.check !== "references")).toBe(true);
  });

  it("un dead end nuevo sobre una sala sana empeora el draft", () => {
    const before = validateRoomPackage(cloneFixture());
    const pkg = cloneFixture();
    pkg.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = [];
    const delta = compareValidationReports(before, validateRoomPackage(pkg));

    expect(delta.worsened).toBe(true);
    expect(delta.introducedErrors.map((f) => f.key)).toContain("dead_ends|dead_end|p-llave-cuadro");
    expect(delta.persistingErrors).toEqual([]);
  });

  it("perder la solvabilidad de un tamaño de grupo que la tenía es un error nuevo", () => {
    const before = validateRoomPackage(cloneFixture());
    const pkg = cloneFixture();
    pkg.objects.find((o) => o.id === "reja-escalera")!.lockedBy = "p-sello-final";
    const delta = compareValidationReports(before, validateRoomPackage(pkg));

    expect(delta.lostSolvability).toEqual([1, 2, 3, 4]);
    expect(delta.introducedErrors.some((f) => f.code === "unsolvable")).toBe(true);
    expect(delta.worsened).toBe(true);
  });

  it("los errores previos que la mutación no empeora no cuentan como nuevos", () => {
    const broken = cloneFixture();
    broken.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = [];
    const before = validateRoomPackage(broken);

    // Cambio inocuo: un diálogo nuevo no toca los dead ends que ya había.
    const next = structuredClone(broken);
    next.dialogs.push({ id: "d-nuevo", text: { es: { text: "Hola" } } });
    const delta = compareValidationReports(before, validateRoomPackage(next));

    expect(delta.worsened).toBe(false);
    expect(delta.introducedErrors).toEqual([]);
    expect(delta.persistingErrors.length).toBeGreaterThan(0);
  });

  it("arreglar el draft resuelve sus errores", () => {
    const broken = cloneFixture();
    broken.puzzles.find((p) => p.id === "p-llave-cuadro")!.grantsItems = [];
    const delta = compareValidationReports(
      validateRoomPackage(broken),
      validateRoomPackage(cloneFixture()),
    );
    expect(delta.worsened).toBe(false);
    expect(delta.resolvedErrors.map((f) => f.key)).toContain("dead_ends|dead_end|p-llave-cuadro");
  });

  it("sin victoria todavía, lo que bloquea la solvabilidad puede cambiar sin empeorar", () => {
    const before = validateRoomPackage(withoutVictory(cloneFixture()));
    expect(before.solvability.every((r) => !r.solvable)).toBe(true);

    // Otro tamaño de sala a medio hacer: la lista de bloqueos de solvabilidad cambia.
    const next = withoutVictory(cloneFixture());
    next.objects.find((o) => o.id === "reja-escalera")!.lockedBy = "p-sello-final";
    const after = validateRoomPackage(next);
    const delta = compareValidationReports(before, after);

    expect(delta.lostSolvability).toEqual([]);
    expect(delta.introducedErrors.every((f) => f.code !== "unsolvable")).toBe(true);
    // …pero la puerta bloqueada sí es un dead end nuevo.
    expect(delta.introducedErrors.map((f) => f.key)).toContain("dead_ends|dead_end|reja-escalera");
  });

  it("sin informe previo (null), todo ❌ salvo la no-solvabilidad cuenta como nuevo", () => {
    const after = validateRoomPackage(withoutVictory(cloneFixture()));
    const delta = compareValidationReports(null, after);
    expect(delta.lostSolvability).toEqual([]);
    expect(delta.introducedErrors).toEqual([]);
    expect(delta.persistingErrors.map((f) => f.code)).toContain("unsolvable");
    expect(delta.introducedWarnings.length).toBeGreaterThan(0);
  });
});
