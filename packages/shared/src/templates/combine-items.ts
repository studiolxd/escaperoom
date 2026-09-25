import type { CombineItemsDefinition, PuzzleState, Recipe } from "../schemas";
import { guardPlayable, initialPuzzleState, publicBase } from "./base";

/**
 * Plantilla `combine_items` (specs/06 §2.4). Toda la validación de recetas vive
 * aquí, en `shared`: el servidor comprueba que el inventario posee los
 * ingredientes y aplica la micro-transacción (`consumeInputs` → consume/otorga).
 * El cliente solo recibe una proyección pública (`toCombineItemsPublicView`) que **nunca**
 * incluye el mapa `inputs → output` de las recetas.
 *
 * La lógica es pura: `evaluateCombination` y `applyCombination` no mutan `state`,
 * devuelven objetos nuevos. Así el host (Colyseus/React) decide cuándo y cómo
 * persistirlos y los tests corren sin infraestructura.
 */

/**
 * Clave canónica y estable de una receta: ingredientes ordenados + resultado.
 * Sirve para la idempotencia interna; **no** debe viajar al cliente porque
 * revelaría la solución.
 */
export function recipeKey(recipe: Recipe): string {
  return `${[...recipe.inputs].sort().join("+")}->${recipe.output}`;
}

/**
 * Estado interno de un `combine_items` (nunca sale al cliente tal cual).
 *
 * El puzzle no guarda estado propio más allá de `state`; `inventory` es una
 * instantánea del inventario del jugador sobre la que se evalúa/combinan los
 * ingredientes, y `appliedRecipes` recuerda las recetas ya ejecutadas (clave
 * canónica) para que una inspección (`consumeInputs: false`) no se repita.
 */
export interface CombineItemsState {
  /** `locked` si depende de otro puzzle; `available`/`in_progress`/`solved` si no. */
  state: PuzzleState;
  /** Ids de item que el jugador posee en el momento de combinar. */
  inventory: string[];
  /** Claves canónicas (`recipeKey`) de recetas ya aplicadas. */
  appliedRecipes: string[];
  solvedAt?: number;
  solvedBy?: string;
}

/**
 * Resultado de evaluar una combinación propuesta, sin aplicarla. `matchedRecipe`
 * es la receta que casa con `input` y `hasInputs` indica si el inventario posee
 * todos sus ingredientes (validación de posesión que exige specs/06 §2.4).
 */
export interface CombinationEvaluation {
  matchedRecipe: Recipe | null;
  output: string | null;
  consumeInputs: boolean;
  hasInputs: boolean;
}

/** Desenlace de aplicar una combinación. */
export type CombinationOutcome =
  "combined" | "already_applied" | "invalid_combination" | "missing_items" | "unavailable";

export interface CombinationResult {
  outcome: CombinationOutcome;
  /** Estado resultante (nuevo objeto; `state` de entrada no se muta). */
  state: CombineItemsState;
  /** Receta aplicada, o la que casó pero no pudo aplicarse. */
  matchedRecipe: Recipe | null;
  output: string | null;
  consumeInputs: boolean;
}

/**
 * Proyección que viaja al cliente: inventario y estado del puzzle para que
 * `<InventoryPanel>` pinte la rejilla. No incluye recetas, `inputs` ni `output`.
 */
export interface CombineItemsPublicView {
  id: string;
  type: "combine_items";
  state: PuzzleState;
  /** Ids de item del inventario (el panel los resuelve a nombre/icono). */
  inventory: string[];
  /** Nº total de recetas (solo el cardinal, no su contenido). */
  recipeCount: number;
  /** Nº de recetas ya descubiertas/aplicadas. */
  appliedRecipeCount: number;
  solvedAt: number | null;
  solvedBy: string | null;
}

/** Un `combine_items` con `requiresSolved` pendiente arranca `locked`; si no, `available`. */
export function createCombineItemsState(
  def: CombineItemsDefinition,
  inventory: string[] = [],
): CombineItemsState {
  return {
    state: initialPuzzleState(def.requiresSolved),
    inventory: [...inventory],
    appliedRecipes: [],
  };
}

/**
 * Busca la receta que casa con `input`. El orden de los inputs es indiferente
 * para las recetas del MVP (se compara el multiconjunto, así que los duplicados
 * también cuentan).
 */
export function findRecipe(def: CombineItemsDefinition, input: string[]): Recipe | null {
  for (const recipe of def.recipes) {
    if (sameMultiset(recipe.inputs, input)) return recipe;
  }
  return null;
}

/** Evalúa la combinación propuesta sin aplicar cambios (pura). */
export function evaluateCombination(
  state: CombineItemsState,
  def: CombineItemsDefinition,
  input: string[],
): CombinationEvaluation {
  const matchedRecipe = findRecipe(def, input);
  if (matchedRecipe === null) {
    return { matchedRecipe: null, output: null, consumeInputs: false, hasInputs: false };
  }
  const hasInputs = unique(matchedRecipe.inputs).every((itemId) =>
    state.inventory.includes(itemId),
  );
  return {
    matchedRecipe,
    output: matchedRecipe.output,
    consumeInputs: matchedRecipe.consumeInputs,
    hasInputs,
  };
}

/**
 * Aplica una combinación sobre una copia de `state` (inmutable). Valida el
 * orden de prelación: disponibilidad → receta existente → no repetida (si no
 * consume) → posesión de ingredientes. Consumir recetas es repetible mientras
 * el inventario conserve los ingredientes; las inspecciones no se repiten.
 */
export function applyCombination(
  state: CombineItemsState,
  def: CombineItemsDefinition,
  input: string[],
  now = 0,
): CombinationResult {
  const evaluation = evaluateCombination(state, def, input);
  const { matchedRecipe, output, consumeInputs } = evaluation;
  const base = { matchedRecipe, output, consumeInputs };

  if (guardPlayable(state.state) === "unavailable") {
    return { outcome: "unavailable", state, ...base };
  }
  if (matchedRecipe === null) {
    return { outcome: "invalid_combination", state, ...base };
  }
  if (!consumeInputs && state.appliedRecipes.includes(recipeKey(matchedRecipe))) {
    return { outcome: "already_applied", state, ...base };
  }
  if (!evaluation.hasInputs) {
    return { outcome: "missing_items", state, ...base };
  }

  const inventory = [...state.inventory];
  if (consumeInputs) {
    for (const itemId of unique(matchedRecipe.inputs)) {
      const index = inventory.indexOf(itemId);
      if (index >= 0) inventory.splice(index, 1);
    }
  }
  if (!inventory.includes(matchedRecipe.output)) inventory.push(matchedRecipe.output);

  const key = recipeKey(matchedRecipe);
  const appliedRecipes = state.appliedRecipes.includes(key)
    ? state.appliedRecipes
    : [...state.appliedRecipes, key];
  const solved = def.recipes.every((recipe) => appliedRecipes.includes(recipeKey(recipe)));

  const next: CombineItemsState = {
    ...state,
    state: solved ? "solved" : "in_progress",
    inventory,
    appliedRecipes,
  };
  if (solved) next.solvedAt = now;
  return { outcome: "combined", state: next, ...base };
}

/**
 * Proyección pública: inventario y estado, sin recetas ni solución.
 *
 * Se prefija con `CombineItems` (como el resto de plantillas) para no
 * colisionar al reexportar las plantillas con `export *`.
 */
export function toCombineItemsPublicView(
  state: CombineItemsState,
  def: CombineItemsDefinition,
): CombineItemsPublicView {
  return {
    ...publicBase(def.id, "combine_items", state.state, state.solvedAt, state.solvedBy),
    inventory: [...state.inventory],
    recipeCount: def.recipes.length,
    appliedRecipeCount: state.appliedRecipes.length,
  };
}

/**
 * Comprobación simple para el validador futuro: la definición tiene recetas
 * utilizables (al menos un ingrediente por receta) y el estado aún puede
 * resolverse.
 */
export function isCombineItemsSolvable(
  state: CombineItemsState,
  def: CombineItemsDefinition,
): boolean {
  if (state.state === "failed") return false;
  return isCoherentCombineItemsDefinition(def);
}

/** `true` si cada receta declara al menos un ingrediente y un `output` no vacío. */
export function isCoherentCombineItemsDefinition(def: CombineItemsDefinition): boolean {
  if (def.recipes.length === 0) return false;
  return def.recipes.every((recipe) => recipe.inputs.length > 0 && recipe.output.trim().length > 0);
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
