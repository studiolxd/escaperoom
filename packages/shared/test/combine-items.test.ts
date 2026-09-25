import { describe, expect, it } from "vitest";
import {
  applyCombination,
  createCombineItemsState,
  evaluateCombination,
  findRecipe,
  isCoherentCombineItemsDefinition,
  isCombineItemsSolvable,
  recipeKey,
  toCombineItemsPublicView,
  type CombineItemsState,
} from "../src/templates";
import { CombineItemsDefinitionSchema, type CombineItemsDefinition } from "../src/schemas";

/** `p-combina` del Rey Aldric: una receta que consume y una inspección que no. */
function makeDef(overrides: Partial<CombineItemsDefinition> = {}): CombineItemsDefinition {
  return CombineItemsDefinitionSchema.parse({
    id: "p-combina",
    type: "combine_items",
    layer: "panel",
    roomId: "salon-trono",
    requiresSolved: [],
    grantsItems: [],
    unlocks: ["compuerta-oro"],
    recipes: [
      { inputs: ["yesquero", "vela"], output: "antorcha", consumeInputs: true },
      {
        inputs: ["llave-plata"],
        output: "llave-oro",
        consumeInputs: false,
        description: "Inspeccionar: una llave dentro de otra",
      },
    ],
    ...overrides,
  });
}

function stateWith(inventory: string[], def = makeDef()): CombineItemsState {
  return createCombineItemsState(def, inventory);
}

describe("combine_items · estado inicial", () => {
  it("arranca disponible sin requiresSolved pendientes", () => {
    const state = createCombineItemsState(makeDef());
    expect(state.state).toBe("available");
    expect(state.inventory).toEqual([]);
    expect(state.appliedRecipes).toEqual([]);
  });

  it("arranca bloqueado si depende de otro puzzle", () => {
    const state = createCombineItemsState(makeDef({ requiresSolved: ["p-mural-vendimia"] }));
    expect(state.state).toBe("locked");
  });
});

describe("combine_items · evaluación de recetas", () => {
  it("yesquero + vela casa con la receta que consume", () => {
    const def = makeDef();
    const evaluation = evaluateCombination(stateWith(["yesquero", "vela"], def), def, [
      "yesquero",
      "vela",
    ]);
    expect(evaluation.matchedRecipe).not.toBeNull();
    expect(evaluation.output).toBe("antorcha");
    expect(evaluation.consumeInputs).toBe(true);
    expect(evaluation.hasInputs).toBe(true);
  });

  it("el orden de los inputs es indiferente", () => {
    const def = makeDef();
    const direct = findRecipe(def, ["yesquero", "vela"]);
    const swapped = findRecipe(def, ["vela", "yesquero"]);
    expect(direct).not.toBeNull();
    expect(swapped?.output).toBe("antorcha");
  });

  it("una receta inexistente no casa", () => {
    const def = makeDef();
    const evaluation = evaluateCombination(stateWith(["yesquero"], def), def, ["yesquero", "cuerda"]);
    expect(evaluation.matchedRecipe).toBeNull();
    expect(evaluation.output).toBeNull();
    expect(evaluation.consumeInputs).toBe(false);
  });

  it("marca hasInputs=false si falta algún ingrediente", () => {
    const def = makeDef();
    const evaluation = evaluateCombination(stateWith(["yesquero"], def), def, ["yesquero", "vela"]);
    expect(evaluation.matchedRecipe).not.toBeNull();
    expect(evaluation.hasInputs).toBe(false);
  });
});

describe("combine_items · aplicar recetas", () => {
  it("yesquero + vela → antorcha consume los ingredientes", () => {
    const def = makeDef();
    const state = stateWith(["yesquero", "vela"], def);
    const result = applyCombination(state, def, ["yesquero", "vela"], 1_000);

    expect(result.outcome).toBe("combined");
    expect(result.output).toBe("antorcha");
    expect(result.state.inventory).toContain("antorcha");
    expect(result.state.inventory).not.toContain("yesquero");
    expect(result.state.inventory).not.toContain("vela");
    // La otra receta sigue pendiente → in_progress, no solved.
    expect(result.state.state).toBe("in_progress");
  });

  it("llave-plata → llave-oro NO consume el ingrediente", () => {
    const def = makeDef();
    const result = applyCombination(stateWith(["llave-plata"], def), def, ["llave-plata"], 2_000);

    expect(result.outcome).toBe("combined");
    expect(result.output).toBe("llave-oro");
    expect(result.state.inventory).toEqual(["llave-plata", "llave-oro"]);
  });

  it("no muta el estado de entrada (lógica pura)", () => {
    const def = makeDef();
    const state = stateWith(["yesquero", "vela"], def);
    applyCombination(state, def, ["yesquero", "vela"], 1_000);
    expect(state.inventory).toEqual(["yesquero", "vela"]);
    expect(state.state).toBe("available");
    expect(state.appliedRecipes).toEqual([]);
  });

  it("rechaza una receta inexistente", () => {
    const def = makeDef();
    const result = applyCombination(stateWith(["yesquero", "vela"], def), def, [
      "yesquero",
      "cuerda",
    ]);
    expect(result.outcome).toBe("invalid_combination");
    expect(result.state.inventory).toEqual(["yesquero", "vela"]);
  });

  it("no combina si faltan ingredientes (validación de posesión)", () => {
    const def = makeDef();
    const state = stateWith(["vela"], def);
    const result = applyCombination(state, def, ["yesquero", "vela"]);
    expect(result.outcome).toBe("missing_items");
    expect(result.state.inventory).toEqual(["vela"]);
  });

  it("un puzzle bloqueado no acepta combinaciones", () => {
    const def = makeDef({ requiresSolved: ["p-mural-vendimia"] });
    const result = applyCombination(stateWith(["yesquero", "vela"], def), def, ["yesquero", "vela"]);
    expect(result.outcome).toBe("unavailable");
    expect(result.state.state).toBe("locked");
  });

  it("marca solved cuando se aplican todas las recetas", () => {
    const def = makeDef();
    const first = applyCombination(stateWith(["yesquero", "vela", "llave-plata"], def), def, [
      "yesquero",
      "vela",
    ]);
    expect(first.state.state).toBe("in_progress");

    const second = applyCombination(first.state, def, ["llave-plata"]);
    expect(second.outcome).toBe("combined");
    expect(second.state.state).toBe("solved");
  });
});

describe("combine_items · idempotencia", () => {
  it("una inspección (consumeInputs:false) no se repite ni duplica el output", () => {
    const def = makeDef();
    const first = applyCombination(stateWith(["llave-plata"], def), def, ["llave-plata"], 1_000);

    const second = applyCombination(first.state, def, ["llave-plata"], 2_000);
    expect(second.outcome).toBe("already_applied");
    expect(second.state).toEqual(first.state);
    expect(second.state.inventory.filter((item) => item === "llave-oro")).toHaveLength(1);
  });

  it("una receta que consume no vuelve a aplicarse sin ingredientes", () => {
    const def = makeDef();
    const first = applyCombination(stateWith(["yesquero", "vela"], def), def, ["yesquero", "vela"]);
    const second = applyCombination(first.state, def, ["yesquero", "vela"]);
    expect(second.outcome).toBe("missing_items");
    expect(second.state).toEqual(first.state);
    expect(second.state.inventory.filter((item) => item === "antorcha")).toHaveLength(1);
  });

  it("recipeKey es estable e independiente del orden de los inputs", () => {
    const recipe = makeDef().recipes[0];
    if (!recipe) throw new Error("receta esperada");
    expect(recipeKey(recipe)).toBe("vela+yesquero->antorcha");
  });
});

describe("combine_items · proyección pública", () => {
  it("no filtra los inputs ni el output de las recetas", () => {
    const def = makeDef();
    const view = toCombineItemsPublicView(stateWith(["cuerda"], def), def);
    const serialized = JSON.stringify(view);

    expect(view).not.toHaveProperty("recipes");
    for (const token of ["yesquero", "vela", "antorcha", "llave-plata", "llave-oro"]) {
      expect(serialized).not.toContain(token);
    }
  });

  it("expone inventario y contadores para el panel", () => {
    const def = makeDef();
    const state = applyCombination(stateWith(["yesquero", "vela"], def), def, [
      "yesquero",
      "vela",
    ]).state;
    const view = toCombineItemsPublicView(state, def);

    expect(view.id).toBe(def.id);
    expect(view.type).toBe("combine_items");
    expect(view.inventory).toEqual(["antorcha"]);
    expect(view.recipeCount).toBe(2);
    expect(view.appliedRecipeCount).toBe(1);
    expect(view.solvedAt).toBeNull();
  });
});

describe("combine_items · solvencia (validador futuro)", () => {
  it("una definición coherente es resoluble", () => {
    const def = makeDef();
    expect(isCoherentCombineItemsDefinition(def)).toBe(true);
    expect(isCombineItemsSolvable(createCombineItemsState(def), def)).toBe(true);
  });

  it("una definición con recetas vacías no es resoluble", () => {
    const def = makeDef({ recipes: [] });
    expect(isCoherentCombineItemsDefinition(def)).toBe(false);
    expect(isCombineItemsSolvable(createCombineItemsState(def), def)).toBe(false);
  });
});
