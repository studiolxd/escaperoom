import type { RoomPackage } from "../schemas";
import type { RoomIndex } from "./model";
import type { AssetManifestInput, ValidationIssue } from "./types";

/**
 * Heurísticos 🟡 del validador del editor (specs/09 §5, specs/22 §2.4) que
 * 2.9 dejó para 3.7: puzzles sin pista, ítems gastados por más de una receta y
 * assets que el manifest del pack no declara. Ninguno bloquea `publish()`.
 */

// ---------------------------------------------------------------------------
// Puzzles sin pista asociada
// ---------------------------------------------------------------------------

/**
 * Puzzles que ninguna `HintDef` referencia (`hint.puzzleId`). Los
 * `code_lock` quedan fuera: su cobertura de pistas (incluidos los dígitos que
 * revelan las reglas) ya la evalúa el check `code_hints`
 * (`code_lock_without_hints`), y repetirla daría dos avisos por candado.
 */
export function checkPuzzleHints(pkg: RoomPackage): ValidationIssue[] {
  const hinted = new Set(pkg.hints.map((hint) => hint.puzzleId));
  return pkg.puzzles
    .filter((puzzle) => puzzle.type !== "code_lock" && !hinted.has(puzzle.id))
    .map((puzzle) => ({
      code: "puzzle_without_hint",
      message: `ninguna pista referencia «${puzzle.id}» (${puzzle.type}): si el grupo se atasca, el sistema de pistas no tiene nada que ofrecer`,
      ids: [puzzle.id],
    }));
}

// ---------------------------------------------------------------------------
// consumeInputs en más de una receta
// ---------------------------------------------------------------------------

/**
 * Ítems que son input de más de una receta (`combine_items`) cuando al menos
 * una de ellas los gasta (`consumeInputs: true`): si el grupo los gasta
 * primero en la receta "equivocada", la otra queda sin input (posible
 * soft-lock, specs/22 §2.4). Una regla repetible que devuelve el ítem (patrón
 * `r-recoger-caliz`) lo resuelve y no se avisa.
 */
export function checkRecipeConsumption(index: RoomIndex): ValidationIssue[] {
  const usage = new Map<string, { recipes: string[]; consuming: string[] }>();
  for (const puzzle of index.pkg.puzzles) {
    if (puzzle.type !== "combine_items") continue;
    for (const recipe of puzzle.recipes) {
      const label = `${recipe.inputs.join("+")}→${recipe.output} (${puzzle.id})`;
      for (const itemId of new Set(recipe.inputs)) {
        const entry = usage.get(itemId) ?? { recipes: [], consuming: [] };
        entry.recipes.push(label);
        if (recipe.consumeInputs) entry.consuming.push(label);
        usage.set(itemId, entry);
      }
    }
  }

  const issues: ValidationIssue[] = [];
  for (const [itemId, { recipes, consuming }] of usage) {
    if (recipes.length < 2 || consuming.length === 0) continue;
    const sources = index.itemSources.get(itemId) ?? [];
    if (sources.some((source) => source.kind === "rule" && source.repeatable)) continue;
    issues.push({
      code: "consumed_in_several_recipes",
      message: `«${itemId}» es input de ${recipes.length} recetas (${recipes.join("; ")}) y ${consuming.length === 1 ? "una lo gasta" : `${consuming.length} lo gastan`} (consumeInputs: true): posible soft-lock si se usa primero en la receta equivocada`,
      ids: [itemId],
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Assets del manifest
// ---------------------------------------------------------------------------

/** `tileId` no nulos de una capa RLE `[cantidad, tileId, …]`. */
function tileIdsOf(rle: readonly number[]): number[] {
  const ids: number[] = [];
  for (let i = 1; i < rle.length; i += 2) {
    const tileId = rle[i]!;
    if (tileId !== 0) ids.push(tileId);
  }
  return ids;
}

/**
 * Assets referenciados por el `RoomPackage` que el manifest del pack no
 * declara: `tileId` de las capas (`manifest.tiles`), sprites de objetos, de
 * sus estados, de la decoración y de los escondites (`manifest.sprites`) e
 * iconos de items (`manifest.ui.icons`). Es la misma cobertura que
 * `validatePackAgainstModel` de game-runtime, sobre el paquete en crudo (el
 * validador no depende del runtime). El runtime pinta un placeholder donde
 * falta el frame, así que la sala "funciona" pero se ve rota: 🟡.
 */
export function checkAssets(pkg: RoomPackage, manifest: AssetManifestInput): ValidationIssue[] {
  const tiles = new Map<number, string[]>();
  const sprites = new Map<string, string[]>();
  const icons = new Map<string, string[]>();
  const add = <K>(map: Map<K, string[]>, key: K, ownerId: string): void => {
    const owners = map.get(key) ?? [];
    if (!owners.includes(ownerId)) owners.push(ownerId);
    map.set(key, owners);
  };

  for (const room of pkg.map.rooms) {
    for (const layer of room.layers) {
      for (const tileId of tileIdsOf(layer.rle)) add(tiles, tileId, room.id);
    }
    for (const decoration of room.decorations) add(sprites, decoration.sprite, room.id);
  }
  for (const object of pkg.objects) {
    add(sprites, object.sprite, object.id);
    for (const state of Object.values(object.states)) {
      const sprite = typeof state === "string" ? state : state.sprite;
      if (sprite !== undefined) add(sprites, sprite, object.id);
    }
  }
  for (const puzzle of pkg.puzzles) {
    if (puzzle.type === "hidden_key" && puzzle.hidingSpot.sprite !== undefined) {
      add(sprites, puzzle.hidingSpot.sprite, puzzle.id);
    }
  }
  for (const item of pkg.items) add(icons, item.icon, item.id);

  const declaredTiles = manifest.tiles ?? {};
  const declaredSprites = manifest.sprites ?? {};
  const declaredIcons = manifest.ui?.icons ?? {};
  const issues: ValidationIssue[] = [];
  const where = (owners: string[]) => `usado en ${owners.join(", ")}`;

  for (const [tileId, owners] of [...tiles].sort((a, b) => a[0] - b[0])) {
    if (Object.hasOwn(declaredTiles, String(tileId))) continue;
    issues.push({
      code: "missing_tile_asset",
      message: `el tileId ${tileId} (${where(owners)}) no existe en manifest.tiles`,
      ids: owners,
    });
  }
  for (const [sprite, owners] of [...sprites].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (Object.hasOwn(declaredSprites, sprite)) continue;
    issues.push({
      code: "missing_sprite_asset",
      message: `el sprite «${sprite}» (${where(owners)}) no existe en manifest.sprites`,
      ids: owners,
    });
  }
  for (const [icon, owners] of [...icons].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (Object.hasOwn(declaredIcons, icon)) continue;
    issues.push({
      code: "missing_icon_asset",
      message: `el icono «${icon}» (${where(owners)}) no existe en manifest.ui.icons`,
      ids: owners,
    });
  }
  return issues;
}
