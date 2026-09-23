import { describe, expect, it } from "vitest";
import {
  MEMORY_DEFAULT_MAX_FLIPS_PER_TURN,
  createMemoryState,
  flipCard,
  isCoherentMemoryDefinition,
  isMemorySolvable,
  maxFlipsPerTurnOf,
  memoryCardCount,
  memoryCols,
  memoryRows,
  shuffleMemoryCards,
  toMemoryPublicView,
  type MemoryRng,
  type MemoryState,
} from "../src/templates";
import { MemoryPuzzleDefinitionSchema, type MemoryPuzzleDefinition } from "../src/schemas";

/** `p-copas-memoria` del Rey Aldric: 3 pares, turno compartido, 2 volteos. */
function makeDef(overrides: Partial<MemoryPuzzleDefinition> = {}): MemoryPuzzleDefinition {
  return MemoryPuzzleDefinitionSchema.parse({
    id: "p-copas-memoria",
    type: "memory",
    layer: "panel",
    roomId: "bodega",
    requiresSolved: [],
    grantsItems: [],
    unlocks: ["reja-escalera"],
    pairs: [
      { id: "par-uva", symbol: "uva" },
      { id: "par-sol", symbol: "sol" },
      { id: "par-llave", symbol: "llave" },
    ],
    decoys: 0,
    maxFlipsPerTurn: 2,
    winCondition: "find_all_pairs",
    turnMode: "shared",
    ...overrides,
  });
}

/** RNG determinista tipo mulberry32, sin `Math.random`. */
function seededRng(seed: number): MemoryRng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeState(def = makeDef(), seed = 1): MemoryState {
  return createMemoryState(def, seededRng(seed));
}

/** Localiza el id de la carta que oculta `symbol` (view del servidor/test). */
function cardIdsForSymbol(state: MemoryState, def: MemoryPuzzleDefinition): Map<string, string[]> {
  const bySymbol = new Map<string, string[]>();
  for (const pair of def.pairs) {
    bySymbol.set(
      pair.symbol,
      state.cards.filter((card) => card.symbol === pair.symbol).map((card) => card.id),
    );
  }
  return bySymbol;
}

/** Resuelve todas las parejas en tandas de `maxFlipsPerTurn`, turno compartido. */
function solveAllPairs(state: MemoryState, def: MemoryPuzzleDefinition): MemoryState {
  let current = state;
  const bySymbol = cardIdsForSymbol(current, def);
  for (const pair of def.pairs) {
    const ids = bySymbol.get(pair.symbol) ?? [];
    for (const id of ids) {
      current = flipCard(current, def, id, "p1", 1_000).state;
    }
  }
  return current;
}

describe("memory · estado inicial", () => {
  it("arranca disponible con la mitad de cartas por símbolo", () => {
    const def = makeDef();
    const state = makeState(def);
    expect(state.state).toBe("available");
    expect(state.cards).toHaveLength(6);
    expect(state.flippedCardIds).toEqual([]);
    expect(state.matchedPairIds).toEqual([]);
    expect(state.flipsThisTurn).toBe(0);

    for (const pair of def.pairs) {
      expect(state.cards.filter((card) => card.symbol === pair.symbol)).toHaveLength(2);
    }
  });

  it("arranca bloqueado si depende de otro puzzle", () => {
    const def = makeDef({ requiresSolved: ["p-canal-agua"] });
    const state = createMemoryState(def, seededRng(1));
    expect(state.state).toBe("locked");

    const result = flipCard(state, def, "carta-0", "p1", 0);
    expect(result.outcome).toBe("unavailable");
    expect(result.state.state).toBe("locked");
  });

  it("cuenta parejas + señuelos y calcula filas/columnas", () => {
    const def = makeDef({ decoys: 2 });
    expect(memoryCardCount(def)).toBe(8);
    expect(memoryCols(def)).toBe(3);
    expect(memoryRows(def)).toBe(3);
    expect(makeState(def).cards).toHaveLength(8);
  });

  it("los señuelos llevan símbolos sin pareja", () => {
    const def = makeDef({ decoys: 3 });
    const state = makeState(def);
    const decoys = state.cards.filter((card) => card.symbol.startsWith("decoy:"));
    expect(decoys).toHaveLength(3);
    // Cada señuelo es único, así que nunca casan.
    expect(new Set(decoys.map((card) => card.symbol)).size).toBe(3);
  });
});

describe("memory · voltear cartas", () => {
  it("voltear revela el símbolo y no resuelve con una sola carta", () => {
    const def = makeDef();
    const state = makeState(def);
    const card = state.cards[0]!;
    const result = flipCard(state, def, card.id, "p1", 1_000);

    expect(result.outcome).toBe("flipped");
    expect(result.revealedSymbol).toBe(card.symbol);
    expect(result.state.flippedCardIds).toEqual([card.id]);
    expect(result.state.state).toBe("in_progress");
    expect(result.state.flipsThisTurn).toBe(1);
  });

  it("dos cartas del mismo símbolo forman pareja y resetean el turno", () => {
    const def = makeDef();
    const state = makeState(def);
    const ids = cardIdsForSymbol(state, def).get("uva")!;
    const first = flipCard(state, def, ids[0]!, "p1", 1_000);
    const second = flipCard(first.state, def, ids[1]!, "p1", 1_100);

    expect(second.outcome).toBe("match");
    expect(second.matched).toBe(true);
    expect(second.state.flippedCardIds).toEqual([]);
    expect(second.state.flipsThisTurn).toBe(0);
    expect(second.state.matchedPairIds).toHaveLength(1);
  });

  it("dos cartas distintas agotan el turno sin pareja", () => {
    const def = makeDef();
    const state = makeState(def);
    const uva = cardIdsForSymbol(state, def).get("uva")![0]!;
    const sol = cardIdsForSymbol(state, def).get("sol")![0]!;
    const first = flipCard(state, def, uva, "p1", 1_000);
    const second = flipCard(first.state, def, sol, "p1", 1_100);

    expect(second.outcome).toBe("mismatch");
    expect(second.matched).toBe(false);
    expect(second.state.flippedCardIds).toEqual([]);
    expect(second.state.flipsThisTurn).toBe(0);
    expect(second.state.state).toBe("in_progress");
  });

  it("no muta el estado de entrada (lógica pura)", () => {
    const def = makeDef();
    const state = makeState(def);
    const card = state.cards[0]!;
    flipCard(state, def, card.id, "p1", 1_000);
    expect(state.flippedCardIds).toEqual([]);
    expect(state.state).toBe("available");
  });

  it("rechaza una carta desconocida", () => {
    const result = flipCard(makeState(), makeDef(), "carta-fantasma", "p1", 0);
    expect(result.outcome).toBe("unknown_card");
    expect(result.cardId).toBe("carta-fantasma");
  });

  it("repetir el volteo de una carta boca arriba no muta el estado", () => {
    const def = makeDef();
    const state = makeState(def);
    const card = state.cards[0]!;
    const first = flipCard(state, def, card.id, "p1", 1_000);
    const again = flipCard(first.state, def, card.id, "p1", 1_100);
    expect(again.outcome).toBe("already_flipped");
    expect(again.state).toEqual(first.state);
  });
});

describe("memory · resolución (los 3 pares)", () => {
  it("resolver los 3 pares marca solved con autor y timestamp", () => {
    const def = makeDef();
    const final = solveAllPairs(makeState(def), def);
    expect(final.state).toBe("solved");
    expect(final.matchedPairIds).toHaveLength(3);
    expect(final.solvedBy).toBe("p1");
    expect(final.solvedAt).toBe(1_000);
  });

  it("un puzzle resuelto no vuelve a validar", () => {
    const def = makeDef();
    const solved = solveAllPairs(makeState(def), def);
    const resend = flipCard(solved, def, "carta-0", "p1", 2_000);
    expect(resend.outcome).toBe("already_solved");
    expect(resend.state).toEqual(solved);
  });

  it("find_target_pairs solo exige las parejas objetivo", () => {
    const def = makeDef({
      winCondition: "find_target_pairs",
      targetPairIds: ["par-uva"],
    });
    const state = makeState(def);
    const ids = cardIdsForSymbol(state, def).get("uva")!;
    const first = flipCard(state, def, ids[0]!, "p1", 1_000);
    const second = flipCard(first.state, def, ids[1]!, "p1", 1_100);
    expect(second.outcome).toBe("match");
    expect(second.solved).toBe(true);
    expect(second.state.state).toBe("solved");
  });

  it("find_target_pairs no resuelve con una pareja fuera de objetivo", () => {
    const def = makeDef({
      winCondition: "find_target_pairs",
      targetPairIds: ["par-uva"],
    });
    const state = makeState(def);
    const ids = cardIdsForSymbol(state, def).get("sol")!;
    const first = flipCard(state, def, ids[0]!, "p1", 1_000);
    const second = flipCard(first.state, def, ids[1]!, "p1", 1_100);
    expect(second.outcome).toBe("match");
    expect(second.state.state).toBe("in_progress");
  });
});

describe("memory · turnMode", () => {
  it("shared no cambia de turno al fallar", () => {
    const def = makeDef({ turnMode: "shared" });
    const state = makeState(def);
    const uva = cardIdsForSymbol(state, def).get("uva")![0]!;
    const sol = cardIdsForSymbol(state, def).get("sol")![0]!;
    const first = flipCard(state, def, uva, "p1", 1_000);
    const second = flipCard(first.state, def, sol, "p1", 1_100);
    expect(second.turnChanged).toBe(false);
    expect(second.nextPlayerId).toBeNull();
  });

  it("per_player cambia de turno al fallar", () => {
    const def = makeDef({ turnMode: "per_player" });
    const state = makeState(def);
    const uva = cardIdsForSymbol(state, def).get("uva")![0]!;
    const sol = cardIdsForSymbol(state, def).get("sol")![0]!;
    const first = flipCard(state, def, uva, "p1", 1_000);
    expect(first.state.currentPlayerId).toBe("p1");
    const second = flipCard(first.state, def, sol, "p1", 1_100);

    expect(second.outcome).toBe("turn_ended");
    expect(second.turnChanged).toBe(true);
    expect(second.state.currentPlayerId).not.toBe("p1");
  });

  it("per_player inicializa el turno en el primer jugador que actúa", () => {
    const def = makeDef({ turnMode: "per_player" });
    const state = makeState(def);
    const card = state.cards[0]!;
    const result = flipCard(state, def, card.id, "p9", 1_000);
    expect(result.state.currentPlayerId).toBe("p9");
  });

  it("un jugador que no tiene el turno no puede voltear", () => {
    const def = makeDef({ turnMode: "per_player" });
    const state = makeState(def);
    const uva = cardIdsForSymbol(state, def).get("uva")![0]!;
    const sol = cardIdsForSymbol(state, def).get("sol")![0]!;
    const first = flipCard(state, def, uva, "p1", 1_000);
    const blocked = flipCard(first.state, def, sol, "p2", 1_050);
    expect(blocked.outcome).toBe("not_your_turn");
    expect(blocked.state).toEqual(first.state);
  });

  it("per_player pasa el turno al siguiente jugador que actúa cuando el host no conoce la lista", () => {
    const def = makeDef({ turnMode: "per_player" });
    const state = makeState(def);
    const uva = cardIdsForSymbol(state, def).get("uva")![0]!;
    const sol = cardIdsForSymbol(state, def).get("sol")![0]!;
    const first = flipCard(state, def, uva, "p2", 1_000);
    const second = flipCard(first.state, def, sol, "p2", 1_100);
    expect(second.outcome).toBe("turn_ended");
    expect(second.turnChanged).toBe(true);

    // El siguiente jugador que actúa toma el turno (relevo entre jugadores).
    const next = flipCard(second.state, def, state.cards[2]!.id, "p3", 1_200);
    expect(next.outcome).toBe("flipped");
    expect(next.state.currentPlayerId).toBe("p3");
  });
});

describe("memory · maxFlipsPerTurn", () => {
  it("por defecto son 2 volteos", () => {
    const def = makeDef({ maxFlipsPerTurn: undefined });
    expect(maxFlipsPerTurnOf(def)).toBe(MEMORY_DEFAULT_MAX_FLIPS_PER_TURN);
  });

  it("un turno de 1 volteo pasa el turno tras cada fallo", () => {
    const def = makeDef({ maxFlipsPerTurn: 1 });
    const state = makeState(def);
    const card = state.cards[0]!;
    const result = flipCard(state, def, card.id, "p1", 1_000);
    expect(result.outcome).toBe("mismatch");
    expect(result.state.flippedCardIds).toEqual([]);
    expect(result.state.flipsThisTurn).toBe(0);
  });

  it("un turno de 3 volteos aguanta el primer fallo", () => {
    const def = makeDef({ maxFlipsPerTurn: 3 });
    const state = makeState(def);
    const first = flipCard(state, def, state.cards[0]!.id, "p1", 1_000);
    const second = flipCard(first.state, def, state.cards[1]!.id, "p1", 1_100);
    // Todavía no se agotó el turno: las cartas siguen boca arriba.
    expect(second.state.flippedCardIds).toHaveLength(2);
    expect(second.state.flipsThisTurn).toBe(2);
  });
});

describe("memory · aleatoriedad determinista", () => {
  it("la misma semilla produce el mismo reparto", () => {
    const def = makeDef();
    const a = createMemoryState(def, seededRng(812));
    const b = createMemoryState(def, seededRng(812));
    expect(a.cards.map((card) => card.symbol)).toEqual(b.cards.map((card) => card.symbol));
  });

  it("semillas distintas barajan distinto (sin Math.random)", () => {
    const def = makeDef();
    const a = shuffleMemoryCards(def, seededRng(1)).map((card) => card.symbol);
    const b = shuffleMemoryCards(def, seededRng(2)).map((card) => card.symbol);
    expect(a).not.toEqual(b);
  });

  it("el reparto conserva exactamente los símbolos de la definición", () => {
    const def = makeDef({ decoys: 1 });
    const symbols = shuffleMemoryCards(def, seededRng(7)).map((card) => card.symbol);
    for (const pair of def.pairs) {
      expect(symbols.filter((symbol) => symbol === pair.symbol)).toHaveLength(2);
    }
    expect(symbols.filter((symbol) => symbol.startsWith("decoy:"))).toHaveLength(1);
  });
});

describe("memory · proyección pública (anti-trampa)", () => {
  it("el símbolo NO aparece antes de voltear", () => {
    const def = makeDef();
    const state = makeState(def);
    const view = toMemoryPublicView(state, def);
    const serialized = JSON.stringify(view.cards);

    expect(view.cards.every((card) => card.symbol === null)).toBe(true);
    for (const pair of def.pairs) {
      expect(serialized).not.toContain(pair.symbol);
    }
    // Tampoco se filtra el reparto interno del estado.
    expect(view).not.toHaveProperty("state.cards");
  });

  it("solo la carta volteada expone su símbolo", () => {
    const def = makeDef();
    const state = makeState(def);
    const card = state.cards[0]!;
    const flipped = flipCard(state, def, card.id, "p1", 1_000).state;
    const view = toMemoryPublicView(flipped, def);

    const visible = view.cards.filter((candidate) => candidate.symbol !== null);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(card.id);
    expect(visible[0]?.symbol).toBe(card.symbol);
  });

  it("una pareja resuelta deja ambas cartas visibles y marcadas", () => {
    const def = makeDef();
    const state = makeState(def);
    const ids = cardIdsForSymbol(state, def).get("uva")!;
    const first = flipCard(state, def, ids[0]!, "p1", 1_000);
    const second = flipCard(first.state, def, ids[1]!, "p1", 1_100);
    const view = toMemoryPublicView(second.state, def);

    for (const id of ids) {
      const card = view.cards.find((candidate) => candidate.id === id);
      expect(card?.matched).toBe(true);
      expect(card?.flipped).toBe(true);
      expect(card?.symbol).toBe("uva");
    }
    expect(view.matchedCount).toBe(1);
    expect(view.targetCount).toBe(3);
  });

  it("expone progreso, turno y volteos restantes para el panel", () => {
    const def = makeDef({ turnMode: "per_player" });
    const state = makeState(def);
    const card = state.cards[0]!;
    const flipped = flipCard(state, def, card.id, "p1", 1_000).state;
    const view = toMemoryPublicView(flipped, def);

    expect(view.id).toBe(def.id);
    expect(view.type).toBe("memory");
    expect(view.turnMode).toBe("per_player");
    expect(view.maxFlipsPerTurn).toBe(2);
    expect(view.flipsThisTurn).toBe(1);
    expect(view.flipsRemaining).toBe(1);
    expect(view.currentPlayerId).toBe("p1");
    expect(view.solvedAt).toBeNull();
    expect(view.cols * view.rows).toBeGreaterThanOrEqual(view.cards.length);
  });
});

describe("memory · solvencia (validador futuro)", () => {
  it("una definición coherente es resoluble", () => {
    const def = makeDef();
    expect(isCoherentMemoryDefinition(def)).toBe(true);
    expect(isMemorySolvable(makeState(def), def)).toBe(true);
  });

  it("una definición sin parejas no es coherente", () => {
    const def = makeDef({ pairs: [] });
    expect(isCoherentMemoryDefinition(def)).toBe(false);
    expect(isMemorySolvable(makeState(def), def)).toBe(false);
  });

  it("find_target_pairs exige objetivos válidos y no vacíos", () => {
    expect(
      isCoherentMemoryDefinition(makeDef({ winCondition: "find_target_pairs", targetPairIds: [] })),
    ).toBe(false);
    expect(
      isCoherentMemoryDefinition(
        makeDef({ winCondition: "find_target_pairs", targetPairIds: ["par-fantasma"] }),
      ),
    ).toBe(false);
    expect(
      isCoherentMemoryDefinition(
        makeDef({ winCondition: "find_target_pairs", targetPairIds: ["par-uva"] }),
      ),
    ).toBe(true);
  });
});
