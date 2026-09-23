import { describe, expect, it } from "vitest";
import {
  activePlateIds,
  allPlatesActive,
  createSimultaneousPlatesState,
  isCoherentSimultaneousPlatesDefinition,
  isPlateActive,
  isSimultaneousPlatesSolvable,
  placeSoloBridge,
  setPlateActive,
  toSimultaneousPlatesPublicView,
  windowEndsAt,
  type SimultaneousPlatesState,
} from "../src/templates";
import {
  SimultaneousPlatesDefinitionSchema,
  type SimultaneousPlatesDefinition,
} from "../src/schemas";

/** `p-placas-estatuas` del Rey Aldric: dos placas, ventana de 800 ms, cáliz-puente. */
function makeDef(overrides: Partial<SimultaneousPlatesDefinition> = {}): SimultaneousPlatesDefinition {
  return SimultaneousPlatesDefinitionSchema.parse({
    id: "p-placas-estatuas",
    type: "simultaneous_plates",
    layer: "world",
    roomId: "salon-trono",
    requiresSolved: [],
    grantsItems: [],
    unlocks: ["puerta-bodega"],
    plates: [
      { objectId: "placa-izq", x: 1, y: 2 },
      { objectId: "placa-der", x: 3, y: 4 },
    ],
    windowMs: 800,
    soloBridgeItemId: "caliz-real",
    holdMode: "press",
    ...overrides,
  });
}

function makeState(def = makeDef()): SimultaneousPlatesState {
  return createSimultaneousPlatesState(def);
}

describe("simultaneous_plates · estado inicial", () => {
  it("arranca disponible con todas las placas inactivas", () => {
    const state = makeState();
    expect(state.state).toBe("available");
    expect(Object.keys(state.plates).sort()).toEqual(["placa-der", "placa-izq"]);
    expect(state.plates["placa-izq"]).toEqual({
      objectId: "placa-izq",
      active: false,
      activatedAt: null,
      bridged: false,
    });
    expect(activePlateIds(state, makeDef(), 0)).toEqual([]);
  });

  it("arranca bloqueado si depende de otro puzzle y no acepta activaciones", () => {
    const def = makeDef({ requiresSolved: ["p-mural-vendimia"] });
    const state = createSimultaneousPlatesState(def);
    expect(state.state).toBe("locked");

    const result = setPlateActive(state, def, "placa-izq", true, 0);
    expect(result.outcome).toBe("unavailable");
    expect(result.state.state).toBe("locked");
  });
});

describe("simultaneous_plates · ventana temporal", () => {
  it("dos jugadores activan dentro de la ventana → resuelto", () => {
    const def = makeDef();
    const first = setPlateActive(makeState(def), def, "placa-izq", true, 1_000, "p1");
    expect(first.outcome).toBe("activated");
    expect(first.state.state).toBe("in_progress");
    expect(first.activePlateIds).toEqual(["placa-izq"]);

    const second = setPlateActive(first.state, def, "placa-der", true, 1_500, "p2");
    expect(second.outcome).toBe("solved");
    expect(second.state.state).toBe("solved");
    expect(second.state.solvedAt).toBe(1_500);
    expect(second.state.plates["placa-der"]!.activatedBy).toBe("p2");
    expect(second.activePlateIds).toEqual(["placa-izq", "placa-der"]);
  });

  it("acepta el límite exacto de la ventana (inclusive)", () => {
    const def = makeDef();
    const first = setPlateActive(makeState(def), def, "placa-izq", true, 1_000);
    const second = setPlateActive(first.state, def, "placa-der", true, 1_800);
    expect(second.outcome).toBe("solved");
  });

  it("fuera de la ventana → expira y no resuelve", () => {
    const def = makeDef();
    const first = setPlateActive(makeState(def), def, "placa-izq", true, 1_000);
    const second = setPlateActive(first.state, def, "placa-der", true, 2_000);

    expect(second.outcome).toBe("expired");
    expect(second.state.state).not.toBe("solved");
    expect(second.state.expiredAt).toBe(2_000);
    // La placa vieja caducó; solo queda la recién pulsada.
    expect(second.activePlateIds).toEqual(["placa-der"]);
  });

  it("una pulsación caduca a los windowMs aunque no llegue otra", () => {
    const def = makeDef();
    const first = setPlateActive(makeState(def), def, "placa-izq", true, 1_000);
    const view = toSimultaneousPlatesPublicView(first.state, def, 1_900);
    expect(view.plates[0]?.active).toBe(false);
    expect(view.activeCount).toBe(0);
  });

  it("soltar la placa rompe la simultaneidad", () => {
    const def = makeDef();
    const first = setPlateActive(makeState(def), def, "placa-izq", true, 1_000);
    const release = setPlateActive(first.state, def, "placa-izq", false, 1_100);
    expect(release.outcome).toBe("deactivated");
    expect(release.activePlateIds).toEqual([]);

    const second = setPlateActive(release.state, def, "placa-der", true, 1_200);
    expect(second.outcome).toBe("activated");
    expect(second.state.state).toBe("in_progress");
  });

  it("en modo stand la placa sostenida no caduca", () => {
    const def = makeDef({ holdMode: "stand" });
    const first = setPlateActive(makeState(def), def, "placa-izq", true, 0);
    const second = setPlateActive(first.state, def, "placa-der", true, 10_000);
    expect(second.outcome).toBe("solved");
    expect(windowEndsAt(second.state, def, 10_000)).toBeNull();
  });

  it("no muta el estado de entrada (lógica pura)", () => {
    const def = makeDef();
    const state = makeState(def);
    setPlateActive(state, def, "placa-izq", true, 1_000);
    expect(state.plates["placa-izq"]!.active).toBe(false);
    expect(state.state).toBe("available");
  });

  it("rechaza una placa desconocida", () => {
    const def = makeDef();
    const result = setPlateActive(makeState(def), def, "placa-fantasma", true, 0);
    expect(result.outcome).toBe("unknown_plate");
    expect(result.plateObjectId).toBe("placa-fantasma");
  });
});

describe("simultaneous_plates · objeto-puente (solo)", () => {
  it("en solitario con el puente → resuelto", () => {
    const def = makeDef();
    const bridged = placeSoloBridge(makeState(def), def, 1_000, "placa-izq", "solo");
    expect(bridged.outcome).toBe("activated");
    expect(bridged.state.plates["placa-izq"]!.bridged).toBe(true);
    expect(bridged.state.plates["placa-izq"]!.active).toBe(true);

    const solved = setPlateActive(bridged.state, def, "placa-der", true, 1_500, "solo");
    expect(solved.outcome).toBe("solved");
    expect(solved.state.state).toBe("solved");
  });

  it("el puente fija la primera placa libre si no se indica cuál", () => {
    const def = makeDef();
    const bridged = placeSoloBridge(makeState(def), def, 0);
    expect(bridged.plateObjectId).toBe("placa-izq");
  });

  it("en solitario sin puente → no resuelve", () => {
    const def = makeDef({ soloBridgeItemId: undefined });
    const state = makeState(def);

    const single = setPlateActive(state, def, "placa-der", true, 1_000, "solo");
    expect(single.outcome).toBe("activated");
    expect(single.state.state).toBe("in_progress");
    expect(single.activePlateIds).toEqual(["placa-der"]);

    const noBridge = placeSoloBridge(single.state, def, 1_000, "placa-izq", "solo");
    expect(noBridge.outcome).toBe("unavailable");
    expect(noBridge.state.state).toBe("in_progress");
  });

  it("colocar el puente sobre la única placa resuelve de inmediato", () => {
    const def = makeDef({ plates: [{ objectId: "placa-unica", x: 0, y: 0 }] });
    const result = placeSoloBridge(makeState(def), def, 500);
    expect(result.outcome).toBe("solved");
    expect(result.state.state).toBe("solved");
  });
});

describe("simultaneous_plates · idempotencia", () => {
  it("reactivar una placa ya activa no muta el estado", () => {
    const def = makeDef();
    const first = setPlateActive(makeState(def), def, "placa-izq", true, 1_000);
    const again = setPlateActive(first.state, def, "placa-izq", true, 1_200);
    expect(again.outcome).toBe("already_active");
    expect(again.state).toEqual(first.state);
    expect(again.activePlateIds).toEqual(["placa-izq"]);
  });

  it("soltar una placa ya inactiva no muta el estado", () => {
    const def = makeDef();
    const state = makeState(def);
    const result = setPlateActive(state, def, "placa-izq", false, 1_000);
    expect(result.outcome).toBe("already_inactive");
    expect(result.state).toEqual(state);
  });

  it("un puzzle resuelto no vuelve a validar", () => {
    const def = makeDef();
    const first = setPlateActive(makeState(def), def, "placa-izq", true, 1_000);
    const solved = setPlateActive(first.state, def, "placa-der", true, 1_200);
    expect(solved.outcome).toBe("solved");

    const resend = setPlateActive(solved.state, def, "placa-der", true, 1_300);
    expect(resend.outcome).toBe("already_solved");
    expect(resend.state).toEqual(solved.state);
  });

  it("colocar el puente dos veces es idempotente", () => {
    const def = makeDef();
    const first = placeSoloBridge(makeState(def), def, 1_000, "placa-izq");
    const again = placeSoloBridge(first.state, def, 1_100, "placa-izq");
    expect(again.outcome).toBe("already_active");
    expect(again.state).toEqual(first.state);
  });
});

describe("simultaneous_plates · proyección pública", () => {
  it("no filtra el objeto-puente ni la solución", () => {
    const def = makeDef();
    const view = toSimultaneousPlatesPublicView(makeState(def), def, 0);
    const serialized = JSON.stringify(view);

    expect(view).not.toHaveProperty("soloBridgeItemId");
    expect(view).not.toHaveProperty("grantsItems");
    expect(view).not.toHaveProperty("unlocks");
    expect(serialized).not.toContain("caliz-real");
    expect(serialized).not.toContain("puerta-bodega");
  });

  it("expone progreso, estado por placa y cuenta atrás", () => {
    const def = makeDef();
    const first = setPlateActive(makeState(def), def, "placa-izq", true, 1_000);
    const view = toSimultaneousPlatesPublicView(first.state, def, 1_200);

    expect(view.id).toBe(def.id);
    expect(view.type).toBe("simultaneous_plates");
    expect(view.holdMode).toBe("press");
    expect(view.windowMs).toBe(800);
    expect(view.totalCount).toBe(2);
    expect(view.activeCount).toBe(1);
    expect(view.windowEndsAt).toBe(1_800);
    expect(view.plates).toEqual([
      { objectId: "placa-izq", active: true, bridged: false, activatedAt: 1_000 },
      { objectId: "placa-der", active: false, bridged: false, activatedAt: null },
    ]);
    expect(view.solvedAt).toBeNull();
  });

  it("la proyección refleja el puente sin revelar su id", () => {
    const def = makeDef();
    const bridged = placeSoloBridge(makeState(def), def, 0, "placa-izq");
    const view = toSimultaneousPlatesPublicView(bridged.state, def, 0);
    expect(view.plates[0]?.bridged).toBe(true);
    expect(view.plates[0]?.active).toBe(true);
    expect(JSON.stringify(view)).not.toContain(def.soloBridgeItemId ?? "");
  });
});

describe("simultaneous_plates · solvencia (validador futuro)", () => {
  it("una definición coherente es resoluble", () => {
    const def = makeDef();
    expect(isCoherentSimultaneousPlatesDefinition(def)).toBe(true);
    expect(isSimultaneousPlatesSolvable(makeState(def), def)).toBe(true);
    expect(allPlatesActive(makeState(def), def, 0)).toBe(false);
    expect(isPlateActive(makeState(def).plates["placa-izq"], def, 0)).toBe(false);
  });

  it("una definición sin placas o con ids duplicados no es coherente", () => {
    expect(isCoherentSimultaneousPlatesDefinition(makeDef({ plates: [] }))).toBe(false);
    expect(
      isCoherentSimultaneousPlatesDefinition(
        makeDef({
          plates: [
            { objectId: "placa-x", x: 0, y: 0 },
            { objectId: "placa-x", x: 1, y: 1 },
          ],
        }),
      ),
    ).toBe(false);
  });
});
