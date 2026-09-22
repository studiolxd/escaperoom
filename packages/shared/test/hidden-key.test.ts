import { describe, expect, it } from "vitest";
import {
  createHiddenKeyState,
  hiddenKeyGrantedItem,
  isHiddenKeySolvableGiven,
  revealHiddenKey,
  toHiddenKeyPublicView,
  type HiddenKeyState,
} from "../src/templates";
import { HiddenKeyDefinitionSchema, type HiddenKeyDefinition } from "../src/schemas";

function makeDef(overrides: Partial<HiddenKeyDefinition> = {}): HiddenKeyDefinition {
  return HiddenKeyDefinitionSchema.parse({
    id: "p-llave-cuadro",
    type: "hidden_key",
    layer: "world",
    roomId: "salon-trono",
    position: { x: 6, y: 0 },
    requiresSolved: [],
    grantsItems: ["llave-bronce"],
    unlocks: [],
    hidingSpot: { objectId: "cuadro-aurelio" },
    revealAnimation: "shake",
    ...overrides,
  });
}

describe("hidden_key · estado inicial", () => {
  it("arranca disponible sin requiresSolved pendientes", () => {
    expect(createHiddenKeyState(makeDef())).toEqual({ state: "available" });
  });

  it("arranca bloqueado si depende de otro puzzle", () => {
    const def = makeDef({ requiresSolved: ["p-canal-agua"] });
    expect(createHiddenKeyState(def).state).toBe("locked");
  });

  it("no revela un escondite bloqueado", () => {
    const def = makeDef({ requiresSolved: ["p-canal-agua"] });
    const result = revealHiddenKey(createHiddenKeyState(def), def, 1_000);
    expect(result.outcome).toBe("unavailable");
    expect(result.grantedItemId).toBeNull();
    expect(result.state.state).toBe("locked");
  });
});

describe("hidden_key · reveal", () => {
  it("el cuadro de Aurelio entrega la llave-bronce con animación shake", () => {
    const def = makeDef();
    const result = revealHiddenKey(createHiddenKeyState(def), def, 1_000);

    expect(result.outcome).toBe("revealed");
    expect(result.grantedItemId).toBe("llave-bronce");
    expect(result.state.state).toBe("solved");
    expect(result.state.revealedAt).toBe(1_000);
    expect(result.state.revealedBy).toBeUndefined();
    expect(def.revealAnimation).toBe("shake");
  });

  it("usa keyItemId por encima del primer grantsItems", () => {
    const def = makeDef({ grantsItems: ["otro-item"], keyItemId: "llave-plata" });
    expect(hiddenKeyGrantedItem(def)).toBe("llave-plata");
    expect(revealHiddenKey(createHiddenKeyState(def), def, 1_000).grantedItemId).toBe(
      "llave-plata",
    );
  });

  it("registra revealedBy cuando el host lo aporta", () => {
    const def = makeDef();
    const result = revealHiddenKey(createHiddenKeyState(def), def, 1_000, "jugador-1");
    expect(result.state.revealedBy).toBe("jugador-1");
  });

  it("no muta el estado de entrada (lógica pura)", () => {
    const def = makeDef();
    const state = createHiddenKeyState(def);
    revealHiddenKey(state, def, 1_000);
    expect(state).toEqual({ state: "available" });
  });

  it("es idempotente: un segundo reveal no vuelve a otorgar el objeto", () => {
    const def = makeDef();
    const first = revealHiddenKey(createHiddenKeyState(def), def, 1_000);
    expect(first.outcome).toBe("revealed");

    const second = revealHiddenKey(first.state, def, 2_000);
    expect(second.outcome).toBe("already_revealed");
    expect(second.grantedItemId).toBeNull();
    expect(second.state).toEqual(first.state);
    expect(second.state.revealedAt).toBe(1_000);
  });
});

describe("hidden_key · proyección pública", () => {
  it("el estado público NO revela el objeto antes del reveal", () => {
    const def = makeDef();
    const view = toHiddenKeyPublicView(createHiddenKeyState(def), def);

    expect(view.revealed).toBe(false);
    expect(view.itemId).toBeNull();
    expect(JSON.stringify(view)).not.toContain("llave-bronce");
    expect(Object.keys(view)).not.toContain("keyItemId");
    expect(view.id).toBe(def.id);
    expect(view.hidingSpot).toEqual({ objectId: "cuadro-aurelio" });
  });

  it("revela el objeto y el timestamp solo después del reveal", () => {
    const def = makeDef();
    const revealed = revealHiddenKey(createHiddenKeyState(def), def, 1_000).state;
    const view = toHiddenKeyPublicView(revealed, def);

    expect(view.revealed).toBe(true);
    expect(view.itemId).toBe("llave-bronce");
    expect(view.revealedAt).toBe(1_000);
    expect(JSON.stringify(view)).toContain("llave-bronce");
  });

  it("respeta revealAnimation como dato para la capa visual", () => {
    for (const revealAnimation of ["slide", "fade", "shake"] as const) {
      const view = toHiddenKeyPublicView(
        createHiddenKeyState(makeDef()),
        makeDef({ revealAnimation }),
      );
      expect(view.revealAnimation).toBe(revealAnimation);
      expect(JSON.stringify(view)).toContain(revealAnimation);
    }
  });
});

describe("hidden_key · solvencia (validador futuro)", () => {
  it("una definición con objeto y no fallida es resoluble", () => {
    const def = makeDef();
    expect(isHiddenKeySolvableGiven(createHiddenKeyState(def), def)).toBe(true);
    expect(isHiddenKeySolvableGiven({ state: "solved", revealedAt: 1_000 }, def)).toBe(true);
  });

  it("sin objeto que otorgar no es resoluble", () => {
    const def = makeDef({ grantsItems: [], keyItemId: undefined });
    const state: HiddenKeyState = createHiddenKeyState(def);
    expect(isHiddenKeySolvableGiven(state, def)).toBe(false);
  });

  it("un estado fallido no es resoluble", () => {
    const def = makeDef();
    expect(isHiddenKeySolvableGiven({ state: "failed" }, def)).toBe(false);
  });
});
