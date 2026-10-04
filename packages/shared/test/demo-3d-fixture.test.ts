import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage } from "../src/schemas";
import { renderValidationReport, validateRoomPackage } from "../src/validator";

/** Sala de pruebas 3D (encargo 7.6p §2): fixture versionado, íntegro y resoluble. */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-demo-3d.v1.json", import.meta.url),
);
const pkg = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
const report = validateRoomPackage(pkg);

describe("fixture Sala de pruebas 3D", () => {
  it("pasa parseRoomPackage y es una sala 3D de medieval-v1", () => {
    expect(pkg.meta.id).toBe("room-demo-3d");
    expect(pkg.meta.dimension).toBe("3d");
    expect(pkg.map.tileset).toBe("medieval-v1");
    expect(pkg.map.rooms.map((room) => room.id)).toEqual(["antesala", "camara"]);
  });

  it("validateRoomPackage no devuelve errores", () => {
    const failing = report.checks.filter((check) => check.status === "error");
    expect(failing, renderValidationReport(report)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("es resoluble para 1 a 4 jugadores", () => {
    expect(report.solvability.map((s) => s.playerCount)).toEqual([1, 2, 3, 4]);
    for (const result of report.solvability) expect(result.solvable).toBe(true);
  });

  it("no tiene avisos unknown_model ni unknown_clip", () => {
    const codes = report.checks.flatMap((check) => check.issues.map((issue) => issue.code));
    expect(codes).not.toContain("unknown_model");
    expect(codes).not.toContain("unknown_clip");
    expect(report.checks.find((check) => check.id === "world3d_models")!.issues).toEqual([]);
  });
});
