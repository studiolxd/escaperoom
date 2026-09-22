import { describe, expect, it } from "vitest";
import { HintDefSchema, type HintDef } from "../src/schemas";
import {
  createHintState,
  hintsForPuzzle,
  nextHintForPuzzle,
  requestHint,
  toHintPublicView,
  totalHintCost,
  type HintState,
} from "../src/hints";

function makeDef(overrides: Partial<HintDef> & Pick<HintDef, "id" | "puzzleId" | "tier">): HintDef {
  return HintDefSchema.parse({
    text: { es: { text: `pista ${overrides.tier}` } },
    cost: 1,
    ...overrides,
  });
}

/** Tres tiers escalonados con coste creciente para el mismo puzzle. */
const CANDADO_HINTS: HintDef[] = [
  makeDef({ id: "hint-arca-1", puzzleId: "p-candado-arca", tier: 1, cost: 1 }),
  makeDef({ id: "hint-arca-2", puzzleId: "p-candado-arca", tier: 2, cost: 2 }),
  makeDef({ id: "hint-arca-3", puzzleId: "p-candado-arca", tier: 3, cost: 3 }),
];

describe("hints · estado inicial", () => {
  it("usa la suma de costes como contador por defecto", () => {
    expect(totalHintCost(CANDADO_HINTS)).toBe(6);
    const state = createHintState(CANDADO_HINTS);
    expect(state.remaining).toBe(6);
    expect(state.used).toBe(0);
    expect(state.tierByPuzzle).toEqual({});
  });

  it("acepta un contador explícito y un consumo previo", () => {
    const state = createHintState(CANDADO_HINTS, { totalHints: 4, usedHints: 1 });
    expect(state.remaining).toBe(3);
    expect(state.used).toBe(1);
  });

  it("nunca deja un contador negativo si el consumo previo supera el total", () => {
    const state = createHintState(CANDADO_HINTS, { totalHints: 2, usedHints: 5 });
    expect(state.remaining).toBe(0);
  });
});

describe("hints · pedir pista", () => {
  it("devuelve el primer tier y descuenta su coste de las pistas restantes", () => {
    const state = createHintState(CANDADO_HINTS, { totalHints: 6 });
    const result = requestHint(state, CANDADO_HINTS, "p-candado-arca");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("se esperaba un acierto");
    expect(result.tier).toBe(1);
    expect(result.cost).toBe(1);
    expect(result.remaining).toBe(5);
    expect(result.state.used).toBe(1);
    expect(result.state.tierByPuzzle["p-candado-arca"]).toBe(1);
    expect(result.exhausted).toBe(false);
  });

  it("escala tiers en orden (1 → 2 → 3) y suma el coste por puzzle", () => {
    let state: HintState = createHintState(CANDADO_HINTS, { totalHints: 6 });

    const first = requestHint(state, CANDADO_HINTS, "p-candado-arca");
    if (!first.ok) throw new Error("se esperaba tier 1");
    state = first.state;

    const second = requestHint(state, CANDADO_HINTS, "p-candado-arca");
    if (!second.ok) throw new Error("se esperaba tier 2");
    state = second.state;

    const third = requestHint(state, CANDADO_HINTS, "p-candado-arca");
    if (!third.ok) throw new Error("se esperaba tier 3");
    state = third.state;

    expect([first.tier, second.tier, third.tier]).toEqual([1, 2, 3]);
    expect(third.cost).toBe(3);
    expect(third.exhausted).toBe(true);
    expect(state.remaining).toBe(0);
    expect(state.used).toBe(6);
    expect(state.usedByPuzzle["p-candado-arca"]).toBe(6);
  });

  it("no muta el estado de entrada (lógica pura)", () => {
    const state = createHintState(CANDADO_HINTS, { totalHints: 6 });
    requestHint(state, CANDADO_HINTS, "p-candado-arca");
    expect(state.remaining).toBe(6);
    expect(state.tierByPuzzle).toEqual({});
  });

  it("rechaza con error claro cuando el coste supera las pistas restantes", () => {
    const state = createHintState(CANDADO_HINTS, { totalHints: 0 });
    const result = requestHint(state, CANDADO_HINTS, "p-candado-arca");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("se esperaba un rechazo");
    expect(result.error.code).toBe("insufficient_hints");
    expect(result.error.message).toContain("cuesta 1");
    expect(result.error.message).toContain("quedan 0");
    expect(result.remaining).toBe(0);
    expect(result.state).toBe(state);
  });

  it("rechaza el tier 2 (coste 2) con solo 1 pista restante", () => {
    const first = requestHint(createHintState(CANDADO_HINTS), CANDADO_HINTS, "p-candado-arca");
    if (!first.ok) throw new Error("se esperaba tier 1");

    const withOneLeft = { ...first.state, remaining: 1 };
    const second = requestHint(withOneLeft, CANDADO_HINTS, "p-candado-arca");
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("se esperaba un rechazo");
    expect(second.error.code).toBe("insufficient_hints");
  });

  it("rechaza con no_more_tiers cuando ya se pidieron todos", () => {
    let state = createHintState(CANDADO_HINTS, { totalHints: 6 });
    for (let i = 0; i < 3; i += 1) {
      const result = requestHint(state, CANDADO_HINTS, "p-candado-arca");
      if (!result.ok) throw new Error("se esperaba un acierto");
      state = result.state;
    }

    const again = requestHint(state, CANDADO_HINTS, "p-candado-arca");
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("se esperaba un rechazo");
    expect(again.error.code).toBe("no_more_tiers");
    expect(again.state).toBe(state);
  });

  it("rechaza con unknown_puzzle si el puzzle no tiene pistas", () => {
    const result = requestHint(createHintState(CANDADO_HINTS), CANDADO_HINTS, "p-fantasma");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("se esperaba un rechazo");
    expect(result.error.code).toBe("unknown_puzzle");
  });

  it("ordena los tiers aunque la definición venga desordenada", () => {
    const shuffled = [CANDADO_HINTS[2]!, CANDADO_HINTS[0]!, CANDADO_HINTS[1]!];
    const state = createHintState(shuffled, { totalHints: 6 });
    expect(hintsForPuzzle(shuffled, "p-candado-arca").map((hint) => hint.tier)).toEqual([1, 2, 3]);
    expect(nextHintForPuzzle(state, shuffled, "p-candado-arca")?.tier).toBe(1);
  });
});

describe("hints · proyección pública", () => {
  it("solo revela los tiers ya pedidos y expone el coste del siguiente", () => {
    const state = createHintState(CANDADO_HINTS, { totalHints: 6 });
    const first = requestHint(state, CANDADO_HINTS, "p-candado-arca");
    if (!first.ok) throw new Error("se esperaba un acierto");

    const view = toHintPublicView(first.state, CANDADO_HINTS, "es");
    const puzzle = view.puzzles.find((candidate) => candidate.puzzleId === "p-candado-arca");
    expect(puzzle).toBeDefined();
    expect(puzzle?.tier).toBe(1);
    expect(puzzle?.totalTiers).toBe(3);
    expect(puzzle?.nextCost).toBe(2);
    expect(puzzle?.hints).toHaveLength(1);
    expect(puzzle?.hints[0]?.text).toBe("pista 1");
    expect(view.remaining).toBe(5);
    expect(view.used).toBe(1);
    expect(view.hasMore).toBe(true);
  });

  it("resuelve el texto al idioma pedido con fallback a `es`", () => {
    const defs = [
      makeDef({
        id: "hint-i18n",
        puzzleId: "p-i18n",
        tier: 1,
        text: { es: { text: "texto en castellano" }, en: { text: "english text" } },
      }),
    ];
    const state = requestHint(createHintState(defs), defs, "p-i18n");
    if (!state.ok) throw new Error("se esperaba un acierto");

    const es = toHintPublicView(state.state, defs, "es").puzzles[0]?.hints[0];
    expect(es?.text).toBe("texto en castellano");
    expect(es?.locale).toBe("es");

    const en = toHintPublicView(state.state, defs, "en").puzzles[0]?.hints[0];
    expect(en?.text).toBe("english text");

    const fr = toHintPublicView(state.state, defs, "fr").puzzles[0]?.hints[0];
    expect(fr?.text).toBe("texto en castellano");
    expect(fr?.locale).toBe("es");
  });

  it("cae a la primera entrada si ni el idioma ni el fallback existen", () => {
    const defs = [
      makeDef({
        id: "hint-pt",
        puzzleId: "p-pt",
        tier: 1,
        text: { pt: { text: "texto em português" } },
      }),
    ];
    const state = requestHint(createHintState(defs), defs, "p-pt");
    if (!state.ok) throw new Error("se esperaba un acierto");

    const entry = toHintPublicView(state.state, defs, "de").puzzles[0]?.hints[0];
    expect(entry?.text).toBe("texto em português");
    expect(entry?.locale).toBe("pt");
  });

  it("marca hasMore=false cuando no queda ningún tier pendiente", () => {
    let state = createHintState(CANDADO_HINTS, { totalHints: 6 });
    for (let i = 0; i < 3; i += 1) {
      const result = requestHint(state, CANDADO_HINTS, "p-candado-arca");
      if (!result.ok) throw new Error("se esperaba un acierto");
      state = result.state;
    }
    const view = toHintPublicView(state, CANDADO_HINTS, "es");
    expect(view.hasMore).toBe(false);
    expect(view.puzzles[0]?.nextCost).toBeNull();
    expect(view.puzzles[0]?.hints).toHaveLength(3);
  });
});
