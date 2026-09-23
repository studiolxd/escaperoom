import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PACKAGE_FORMAT,
  RoomPackageSchema,
  formatRoomPackageError,
  parseRoomPackage,
  safeParseRoomPackage,
  toReadableIssues,
} from "../src/schemas";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

function loadFixture(): unknown {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
}

describe("RoomPackage schema", () => {
  it("valida el fixture del Rey Aldric", () => {
    const result = RoomPackageSchema.safeParse(loadFixture());

    if (!result.success) {
      throw new Error(`el fixture no valida:\n${formatRoomPackageError(result.error)}`);
    }

    expect(result.data.meta.id).toBe("room-rey-aldric");
    expect(result.data.meta.packageFormat).toBe("roompackage/v1");
    expect(result.data.map.rooms).toHaveLength(3);
    expect(result.data.puzzles.map((p) => p.type)).toEqual([
      "combine_items",
      "hidden_key",
      "code_lock",
      "simultaneous_plates",
      "sliding_puzzle",
      "memory",
      "split_clue",
      "pipes",
      "code_lock",
    ]);
  });

  it("round-trip: parse/serialize conserva el documento", () => {
    const fixture = loadFixture();
    const parsed = parseRoomPackage(fixture);

    expect(JSON.parse(JSON.stringify(parsed))).toEqual(fixture);
  });

  it("rechaza un meta sin title con una ruta de campo clara", () => {
    const valid = parseRoomPackage(loadFixture());
    const invalid = { ...valid, meta: { ...valid.meta } };
    delete (invalid.meta as { title?: string }).title;

    const result = safeParseRoomPackage(invalid);

    expect(result.success).toBe(false);
    if (result.success) return;

    const issues = toReadableIssues(result.error);
    expect(issues.some((issue) => issue.path === "meta.title")).toBe(true);
    expect(formatRoomPackageError(result.error)).toContain("meta.title");
  });

  it("rechaza un puzzle con config incorrecta con una ruta clara", () => {
    const valid = parseRoomPackage(loadFixture());
    const invalid = structuredClone(valid);
    const index = invalid.puzzles.findIndex((puzzle) => puzzle.type === "code_lock");
    expect(index).toBeGreaterThanOrEqual(0);

    const puzzle = invalid.puzzles[index] as { code: unknown };
    puzzle.code = 4732;

    const result = safeParseRoomPackage(invalid);

    expect(result.success).toBe(false);
    if (result.success) return;

    const path = `puzzles.${index}.code`;
    expect(toReadableIssues(result.error).some((issue) => issue.path === path)).toBe(true);
    expect(formatRoomPackageError(result.error)).toContain(path);
  });

  it("mantiene PACKAGE_FORMAT como el valor canónico fijado", () => {
    expect(PACKAGE_FORMAT).toBe("roompackage/v1");
    expect(
      RoomPackageSchema.shape.meta.shape.packageFormat.safeParse("roompackage/v1").success,
    ).toBe(true);
    expect(RoomPackageSchema.shape.meta.shape.packageFormat.safeParse("").success).toBe(false);
  });
});
