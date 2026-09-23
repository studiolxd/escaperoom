import { describe, expect, it } from "vitest";
import {
  canViewpointSee,
  createSplitClueState,
  effectiveVisibility,
  isCoherentSplitClueDefinition,
  isSplitClueSolvable,
  isSplitClueSolvableForGroup,
  placeSplitClueBridge,
  resolveViewpointForPosition,
  submitCombination,
  toSplitCluePublicView,
  unionVisibility,
  unionCoversAll,
  viewpointAt,
  viewpointVisibility,
  visibleFragmentsByIndex,
  type SplitClueState,
} from "../src/templates";
import { SplitClueDefinitionSchema, type SplitClueDefinition } from "../src/schemas";

/**
 * Pista dividida del Rey Aldric: el código final `4538` repartido entre dos
 * mirillas. `mirilla-a` ve los índices 0 y 2; `mirilla-b`, los índices 1 y 3.
 * El espejo (`espejo`) es el objeto-puente del modo solitario.
 */
function makeDef(overrides: Partial<SplitClueDefinition> = {}): SplitClueDefinition {
  return SplitClueDefinitionSchema.parse({
    id: "p-pista-dividida",
    type: "split_clue",
    layer: "world",
    roomId: "capilla",
    requiresSolved: [],
    grantsItems: [],
    unlocks: ["puerta-cripta"],
    viewpoints: [
      { objectId: "mirilla-a", zone: { x: 0, y: 0, w: 2, h: 2 } },
      { objectId: "mirilla-b", zone: { x: 4, y: 0, w: 2, h: 2 } },
    ],
    fragments: ["4", "5", "3", "8"],
    visibleByViewpoint: {
      "mirilla-a": ["4", null, "3", null],
      "mirilla-b": [null, "5", null, "8"],
    },
    wallOccluder: { x: 2, y: 0, w: 2, h: 2 },
    soloBridgeItemId: "espejo",
    inputUI: "code",
    ...overrides,
  });
}

/** Variante de símbolos: tres fragmentos no numéricos y una sola mirilla ciega a medias. */
function makeSymbolsDef(overrides: Partial<SplitClueDefinition> = {}): SplitClueDefinition {
  return makeDef({
    id: "p-altar-simbolos",
    fragments: ["luna", "sol", "cruz"],
    visibleByViewpoint: {
      "mirilla-a": ["luna", null, "cruz"],
      "mirilla-b": [null, "sol", null],
    },
    inputUI: "symbols",
    ...overrides,
  });
}

function makeState(def = makeDef()): SplitClueState {
  return createSplitClueState(def);
}

describe("split_clue · estado inicial", () => {
  it("arranca disponible y sin espejo", () => {
    const state = makeState();
    expect(state).toEqual({ state: "available", attempts: 0, bridged: false });
  });

  it("arranca bloqueado si depende de otro puzzle y no acepta envíos", () => {
    const def = makeDef({ requiresSolved: ["p-candado"] });
    const state = createSplitClueState(def);
    expect(state.state).toBe("locked");

    const result = submitCombination(state, def, "4538", 0);
    expect(result.outcome).toBe("unavailable");
    expect(result.state.state).toBe("locked");
  });
});

describe("split_clue · información repartida entre puntos de vista", () => {
  it("dos puntos de vista ven fragmentos distintos", () => {
    const def = makeDef();
    const a = viewpointVisibility(def, "mirilla-a");
    const b = viewpointVisibility(def, "mirilla-b");

    expect(a).toEqual(["4", null, "3", null]);
    expect(b).toEqual([null, "5", null, "8"]);
    expect(a).not.toEqual(b);

    expect(canViewpointSee(def, "mirilla-a", 0)).toBe(true);
    expect(canViewpointSee(def, "mirilla-a", 1)).toBe(false);
    expect(canViewpointSee(def, "mirilla-b", 1)).toBe(true);
  });

  it("la unión de los puntos de vista cubre la pista entera", () => {
    const def = makeDef();
    expect(unionVisibility(def)).toEqual(["4", "5", "3", "8"]);
    expect(unionCoversAll(def)).toBe(true);
  });

  it("un punto de vista desconocido no ve nada", () => {
    const def = makeDef();
    expect(viewpointVisibility(def, "mirilla-fantasma")).toEqual([null, null, null, null]);
  });

  it("effectiveVisibility usa la unión solo con el espejo colocado", () => {
    const def = makeDef();
    expect(effectiveVisibility(def, "mirilla-a", false)).toEqual(["4", null, "3", null]);
    expect(effectiveVisibility(def, "mirilla-a", true)).toEqual(["4", "5", "3", "8"]);
  });

  it("exporta el formato de cable split_fragments {[index]: symbol}", () => {
    const def = makeDef();
    expect(visibleFragmentsByIndex(def, "mirilla-a")).toEqual({ 0: "4", 2: "3" });
    expect(visibleFragmentsByIndex(def, "mirilla-a", true)).toEqual({
      0: "4",
      1: "5",
      2: "3",
      3: "8",
    });
  });
});

describe("split_clue · resolución de la combinación", () => {
  it("la combinación correcta resuelve el puzzle", () => {
    const def = makeDef();
    const result = submitCombination(makeState(def), def, "4538", 1_000, "p1");

    expect(result.outcome).toBe("correct");
    expect(result.state.state).toBe("solved");
    expect(result.state.solvedAt).toBe(1_000);
    expect(result.state.solvedBy).toBe("p1");
    expect(result.attempts).toBe(1);
  });

  it("una combinación incorrecta pasa a in_progress y cuenta el intento", () => {
    const def = makeDef();
    const result = submitCombination(makeState(def), def, "1234", 1_000);

    expect(result.outcome).toBe("wrong");
    expect(result.state.state).toBe("in_progress");
    expect(result.state.solvedAt).toBeUndefined();
    expect(result.attempts).toBe(1);
  });

  it("una entrada incompleta no cuenta como intento", () => {
    const def = makeDef();
    const state = makeState(def);
    const result = submitCombination(state, def, "45", 1_000);

    expect(result.outcome).toBe("incomplete");
    expect(result.state).toEqual(state);
    expect(result.attempts).toBe(0);
  });

  it("en modo symbols compara fragmento a fragmento", () => {
    const def = makeSymbolsDef();
    const wrong = submitCombination(makeState(def), def, ["luna", "cruz", "sol"], 0);
    expect(wrong.outcome).toBe("wrong");

    const correct = submitCombination(wrong.state, def, ["luna", "sol", "cruz"], 1_000);
    expect(correct.outcome).toBe("correct");
    expect(correct.state.state).toBe("solved");
  });

  it("no muta el estado de entrada (lógica pura)", () => {
    const def = makeDef();
    const state = makeState(def);
    submitCombination(state, def, "4538", 1_000);
    expect(state.state).toBe("available");
    expect(state.attempts).toBe(0);
  });
});

describe("split_clue · espejo como puente (modo solitario)", () => {
  it("un punto de vista solitario ve el fragmento extra con el espejo", () => {
    const def = makeDef();
    const before = toSplitCluePublicView(makeState(def), def, "mirilla-a");
    expect(before.visible).toEqual(["4", null, "3", null]);
    expect(before.visibleCount).toBe(2);
    expect(before.bridged).toBe(false);

    const bridged = placeSplitClueBridge(makeState(def), def, "solo");
    expect(bridged.outcome).toBe("bridged");
    expect(bridged.state.bridged).toBe(true);
    expect(bridged.state.bridgedBy).toBe("solo");

    const after = toSplitCluePublicView(bridged.state, def, "mirilla-a");
    expect(after.visible).toEqual(["4", "5", "3", "8"]);
    expect(after.visibleCount).toBe(4);
    expect(after.bridged).toBe(true);
  });

  it("con el espejo el jugador solo resuelve la pista", () => {
    const def = makeDef();
    const bridged = placeSplitClueBridge(makeState(def), def, "solo");
    const result = submitCombination(bridged.state, def, "4538", 2_000, "solo");

    expect(result.outcome).toBe("correct");
    expect(result.state.state).toBe("solved");
  });

  it("colocar el espejo dos veces es idempotente", () => {
    const def = makeDef();
    const first = placeSplitClueBridge(makeState(def), def);
    const again = placeSplitClueBridge(first.state, def);
    expect(again.outcome).toBe("already_bridged");
    expect(again.state).toEqual(first.state);
  });

  it("sin `soloBridgeItemId` el puente no está disponible", () => {
    const def = makeDef({ soloBridgeItemId: undefined });
    const result = placeSplitClueBridge(makeState(def), def);
    expect(result.outcome).toBe("unavailable");
    expect(result.state.bridged).toBe(false);
  });

  it("un puzzle resuelto no vuelve a validar", () => {
    const def = makeDef();
    const solved = submitCombination(makeState(def), def, "4538", 1_000);
    const resend = submitCombination(solved.state, def, "4538", 1_100);
    expect(resend.outcome).toBe("already_solved");
    expect(resend.state).toEqual(solved.state);
  });
});

describe("split_clue · proyección pública por punto de vista", () => {
  it("la vista pública de un punto de vista NO incluye fragmentos ajenos", () => {
    const def = makeDef();
    const view = toSplitCluePublicView(makeState(def), def, "mirilla-a");
    const serialized = JSON.stringify(view);

    expect(view.viewpointId).toBe("mirilla-a");
    expect(view.visible).toEqual(["4", null, "3", null]);
    // Los fragmentos que solo ve `mirilla-b` no viajan a `mirilla-a`.
    expect(serialized).not.toContain("5");
    expect(serialized).not.toContain("8");
    expect(serialized).not.toContain("4538");
    // El id del objeto-puente tampoco se filtra; solo que existe.
    expect(view.bridgeAvailable).toBe(true);
    expect(serialized).not.toContain("espejo");
  });

  it("no expone la solución ni los campos comunes sensibles", () => {
    const def = makeDef();
    const view = toSplitCluePublicView(makeState(def), def, "mirilla-b");
    expect(view).not.toHaveProperty("fragments");
    expect(view).not.toHaveProperty("visibleByViewpoint");
    expect(view).not.toHaveProperty("soloBridgeItemId");
    expect(view).not.toHaveProperty("grantsItems");
    expect(view).not.toHaveProperty("unlocks");
  });

  it("refleja progreso y estado", () => {
    const def = makeDef();
    const wrong = submitCombination(makeState(def), def, "1234", 1_000);
    const view = toSplitCluePublicView(wrong.state, def, "mirilla-b");
    expect(view.state).toBe("in_progress");
    expect(view.inputUI).toBe("code");
    expect(view.fragmentsCount).toBe(4);
    expect(view.attempts).toBe(1);
    expect(view.solvedAt).toBeNull();
  });

  it("con el espejo colocado la vista sí incluye la unión (puente)", () => {
    const def = makeDef();
    const bridged = placeSplitClueBridge(makeState(def), def);
    const view = toSplitCluePublicView(bridged.state, def, "mirilla-b");
    expect(view.visible).toEqual(["4", "5", "3", "8"]);
    expect(view.bridged).toBe(true);
    expect(JSON.stringify(view)).not.toContain("espejo");
  });
});

describe("split_clue · geometría de las mirillas", () => {
  it("resuelve el punto de vista según la posición del avatar", () => {
    const def = makeDef();
    expect(viewpointAt(def, 1, 1)).toBe("mirilla-a");
    expect(viewpointAt(def, 5, 1)).toBe("mirilla-b");
    expect(viewpointAt(def, 3, 1)).toBeNull();
    expect(resolveViewpointForPosition(def, 3, 1)).toBe("mirilla-a");
  });
});

describe("split_clue · coherencia y solvencia (validador futuro)", () => {
  it("una definición coherente y cubierta es resoluble", () => {
    const def = makeDef();
    expect(isCoherentSplitClueDefinition(def)).toBe(true);
    expect(isSplitClueSolvable(makeState(def), def)).toBe(true);
  });

  it("detecta máscaras incoherentes", () => {
    expect(
      isCoherentSplitClueDefinition(
        makeDef({ visibleByViewpoint: { "mirilla-a": ["4", null, "3"], "mirilla-b": [null, "5", null, "8"] } }),
      ),
    ).toBe(false);
    expect(
      isCoherentSplitClueDefinition(
        makeDef({
          visibleByViewpoint: { "mirilla-a": ["9", null, "3", null], "mirilla-b": [null, "5", null, "8"] },
        }),
      ),
    ).toBe(false);
    expect(
      isCoherentSplitClueDefinition(
        makeDef({
          viewpoints: [
            { objectId: "mirilla-a", zone: { x: 0, y: 0, w: 2, h: 2 } },
            { objectId: "mirilla-a", zone: { x: 4, y: 0, w: 2, h: 2 } },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isCoherentSplitClueDefinition(
        makeDef({
          visibleByViewpoint: {
            "mirilla-a": ["4", null, "3", null],
            "mirilla-b": [null, "5", null, "8"],
            "mirilla-c": ["4", null, "3", null],
          },
        }),
      ),
    ).toBe(false);
  });

  it("un grupo de dos jugadores cubre la pista; uno solo necesita el espejo", () => {
    const def = makeDef();
    expect(isSplitClueSolvableForGroup(def, 2)).toBe(true);
    expect(isSplitClueSolvableForGroup(def, 1)).toBe(true);

    const noBridge = makeDef({ soloBridgeItemId: undefined });
    expect(isSplitClueSolvableForGroup(noBridge, 2)).toBe(true);
    expect(isSplitClueSolvableForGroup(noBridge, 1)).toBe(false);
  });

  it("sin cobertura completa no es resoluble", () => {
    const def = makeDef({
      visibleByViewpoint: {
        "mirilla-a": ["4", null, null, null],
        "mirilla-b": [null, "5", null, null],
      },
    });
    expect(unionCoversAll(def)).toBe(false);
    expect(isSplitClueSolvable(makeState(def), def)).toBe(false);
    expect(isSplitClueSolvableForGroup(def, 2)).toBe(false);
  });
});
