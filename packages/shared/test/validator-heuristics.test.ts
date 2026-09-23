import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage, type RoomPackage } from "../src/schemas";
import {
  renderValidationReport,
  validateRoomPackage,
  type AssetManifestInput,
  type ValidationCheckId,
  type ValidationReport,
} from "../src/validator";

/**
 * Heurísticos 🟡 añadidos en 3.7 (specs/09 §5, specs/22 §2.4): puzzles sin
 * pista, items con consumeInputs en más de una receta y assets fuera del
 * manifest del pack.
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

/** Manifest que declara exactamente lo que usa el paquete (pack completo). */
function fullManifest(pkg: RoomPackage) {
  const tiles: Record<string, { frame: string; collides: boolean }> = {};
  const sprites: Record<string, { frame: string }> = {};
  const icons: Record<string, string> = {};
  for (const room of pkg.map.rooms) {
    for (const layer of room.layers) {
      for (let i = 1; i < layer.rle.length; i += 2) {
        const tileId = layer.rle[i]!;
        if (tileId !== 0) tiles[String(tileId)] = { frame: `tile-${tileId}`, collides: false };
      }
    }
    for (const decoration of room.decorations) sprites[decoration.sprite] = { frame: "x" };
  }
  for (const object of pkg.objects) {
    sprites[object.sprite] = { frame: "x" };
    for (const state of Object.values(object.states)) {
      const sprite = typeof state === "string" ? state : state.sprite;
      if (sprite) sprites[sprite] = { frame: "x" };
    }
  }
  for (const puzzle of pkg.puzzles) {
    if (puzzle.type === "hidden_key" && puzzle.hidingSpot.sprite) {
      sprites[puzzle.hidingSpot.sprite] = { frame: "x" };
    }
  }
  for (const item of pkg.items) icons[item.icon] = item.icon;
  return { tiles, sprites, ui: { icons } } satisfies AssetManifestInput;
}

describe("validador — puzzles sin pista asociada", () => {
  it("una HintDef nueva quita el puzzle de la lista", () => {
    const pkg = cloneFixture();
    const before = checkOf(validateRoomPackage(pkg), "puzzle_hints");
    expect(before.issues.map((issue) => issue.ids[0])).toContain("p-mural-vendimia");

    pkg.hints.push({
      id: "hint-mural-1",
      puzzleId: "p-mural-vendimia",
      tier: 1,
      text: { es: { text: "Empieza por las esquinas." } },
      cost: 1,
    });
    const after = checkOf(validateRoomPackage(pkg), "puzzle_hints");
    expect(after.issues.map((issue) => issue.ids[0])).not.toContain("p-mural-vendimia");
    expect(after.issues).toHaveLength(before.issues.length - 1);
    expect(after.issues[0]).toMatchObject({ code: "puzzle_without_hint" });
  });

  it("con una pista por puzzle pasa y no aparece en el texto", () => {
    const pkg = cloneFixture();
    for (const puzzle of pkg.puzzles) {
      pkg.hints.push({
        id: `hint-${puzzle.id}`,
        puzzleId: puzzle.id,
        tier: 1,
        text: { es: { text: "…" } },
        cost: 1,
      });
    }
    const report = validateRoomPackage(pkg);
    expect(checkOf(report, "puzzle_hints")).toMatchObject({ status: "ok", passed: true });
    expect(renderValidationReport(report)).not.toContain("sin pista asociada");
  });

  it("un candado sin pistas lo avisa code_hints, no puzzle_hints", () => {
    const pkg = cloneFixture();
    pkg.hints = pkg.hints.filter((hint) => hint.puzzleId !== "p-candado-arca");
    const arca = pkg.puzzles.find((puzzle) => puzzle.id === "p-candado-arca")!;
    if (arca.type !== "code_lock") throw new Error("tipo inesperado");
    delete arca.hints;

    const report = validateRoomPackage(pkg);
    expect(checkOf(report, "puzzle_hints").issues.flatMap((issue) => issue.ids)).not.toContain(
      "p-candado-arca",
    );
    expect(checkOf(report, "code_hints").issues.map((issue) => issue.code)).toContain(
      "code_lock_without_hints",
    );
  });
});

describe("validador — consumeInputs en más de una receta", () => {
  function withSecondRecipe(consumeInputs: boolean): RoomPackage {
    const pkg = cloneFixture();
    const combine = pkg.puzzles.find((puzzle) => puzzle.id === "p-combina")!;
    if (combine.type !== "combine_items") throw new Error("tipo inesperado");
    combine.recipes.push({ inputs: ["mechero", "pergamino"], output: "antorcha", consumeInputs });
    return pkg;
  }

  it("avisa del mechero, gastado por mechero+vela y usado en una segunda receta", () => {
    const report = validateRoomPackage(withSecondRecipe(false));
    const check = checkOf(report, "recipe_consumption");
    expect(check).toMatchObject({ status: "warning", passed: false });
    expect(check.issues).toHaveLength(1);
    expect(check.issues[0]).toMatchObject({
      code: "consumed_in_several_recipes",
      ids: ["mechero"],
    });
    expect(check.issues[0]!.message).toContain("es input de 2 recetas");
    expect(check.issues[0]!.message).toContain("una lo gasta");
    // El pergamino solo está en una receta: sin aviso.
    expect(check.issues.flatMap((issue) => issue.ids)).not.toContain("pergamino");
    expect(renderValidationReport(report)).toContain(
      "🟡 Items con consumeInputs en más de una receta: mechero",
    );
  });

  it("dos recetas que no gastan el ítem no avisan", () => {
    const pkg = withSecondRecipe(false);
    const combine = pkg.puzzles.find((puzzle) => puzzle.id === "p-combina")!;
    if (combine.type !== "combine_items") throw new Error("tipo inesperado");
    combine.recipes[0]!.consumeInputs = false;
    expect(checkOf(validateRoomPackage(pkg), "recipe_consumption").passed).toBe(true);
  });

  it("una regla repetible que devuelve el ítem lo resuelve (patrón r-recoger-caliz)", () => {
    const pkg = withSecondRecipe(true);
    pkg.rules.push({
      id: "r-recoger-mechero",
      priority: 0,
      once: false,
      trigger: { type: "on_interact", objectId: "armario" },
      conditions: [{ type: "flag_is", flag: "mechero-suelto", value: true }],
      actions: [
        { type: "grant_item", itemId: "mechero", to: "interactor" },
        { type: "set_flag", flag: "mechero-suelto", value: false },
      ],
    });
    expect(checkOf(validateRoomPackage(pkg), "recipe_consumption").passed).toBe(true);
  });
});

describe("validador — assets referenciados que no existen en el manifest", () => {
  it("sin manifest no se comprueba (pasa en silencio)", () => {
    const report = validateRoomPackage(reyAldric);
    expect(checkOf(report, "assets")).toMatchObject({
      status: "ok",
      passed: true,
      summary: "Assets no comprobados (sin manifest del pack)",
    });
  });

  it("con el manifest completo pasa", () => {
    const report = validateRoomPackage(reyAldric, { assetManifest: fullManifest(reyAldric) });
    expect(checkOf(report, "assets")).toMatchObject({ status: "ok", passed: true, issues: [] });
  });

  it("señala el tile, el sprite de estado y el icono que faltan, con sus dueños", () => {
    const manifest = fullManifest(reyAldric);
    const [someTile] = Object.keys(manifest.tiles);
    delete manifest.tiles[someTile!];
    delete manifest.sprites["arca-abierta"];
    delete manifest.ui.icons["icon-caliz"];

    const report = validateRoomPackage(reyAldric, { assetManifest: manifest });
    const check = checkOf(report, "assets");
    expect(check).toMatchObject({ status: "warning", passed: false });
    expect(check.issues.map((issue) => issue.code)).toEqual([
      "missing_tile_asset",
      "missing_sprite_asset",
      "missing_icon_asset",
    ]);
    const sprite = check.issues.find((issue) => issue.code === "missing_sprite_asset")!;
    expect(sprite.ids).toEqual(["arca-candado"]);
    expect(sprite.message).toBe(
      "el sprite «arca-abierta» (usado en arca-candado) no existe en manifest.sprites",
    );
    const icon = check.issues.find((issue) => issue.code === "missing_icon_asset")!;
    expect(icon.ids).toEqual(["caliz-real"]);
    expect(renderValidationReport(report)).toContain("🟡 Assets sin declarar en el manifest: 3");
    expect(report.ok).toBe(true);
  });
});
