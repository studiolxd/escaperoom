import { describe, expect, it } from "vitest";
import type { Rule } from "../src/schemas";
import { createEngine, type Engine, type GameEvent, type GameState } from "../src/engine";

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    flags: { game_started: false, game_ended: false },
    puzzleStates: {},
    inventory: { p1: [] },
    objectStates: {},
    timers: {},
    hintsUsed: {},
    startedAt: 0,
    phase: "playing",
    players: { p1: {} },
    ruleRuns: {},
    reveals: {},
    deferred: [],
    lastTickAt: 0,
    ...overrides,
  };
}

function makeRule(partial: Pick<Rule, "id" | "trigger" | "actions"> & Partial<Rule>): Rule {
  return {
    id: partial.id,
    priority: partial.priority ?? 0,
    once: partial.once ?? true,
    trigger: partial.trigger,
    conditions: partial.conditions ?? [],
    actions: partial.actions,
  };
}

function firedIds(engine: Engine, event: GameEvent, now = 0): string[] {
  return engine.dispatch(event, now).fired.map((fired) => fired.ruleId);
}

describe("motor de reglas — prioridad", () => {
  it("evalúa las reglas de mayor priority primero", () => {
    const rules = [
      makeRule({
        id: "r-low",
        priority: 0,
        trigger: { type: "on_interact", objectId: "boton" },
        actions: [{ type: "set_flag", flag: "low", value: true }],
      }),
      makeRule({
        id: "r-high",
        priority: 10,
        trigger: { type: "on_interact", objectId: "boton" },
        actions: [{ type: "set_flag", flag: "high", value: true }],
      }),
    ];
    const engine = createEngine(makeState(), rules);

    expect(firedIds(engine, { type: "on_interact", objectId: "boton" })).toEqual([
      "r-high",
      "r-low",
    ]);
  });

  it("rompe empates por orden de creación", () => {
    const rules = [
      makeRule({
        id: "r-a",
        trigger: { type: "on_interact", objectId: "boton" },
        actions: [],
      }),
      makeRule({
        id: "r-b",
        trigger: { type: "on_interact", objectId: "boton" },
        actions: [],
      }),
    ];
    const engine = createEngine(makeState(), rules);

    expect(firedIds(engine, { type: "on_interact", objectId: "boton" })).toEqual(["r-a", "r-b"]);
  });
});

describe("motor de reglas — transaccionalidad", () => {
  it("aborta la regla entera si una acción falla y sigue con las demás", () => {
    const rules = [
      makeRule({
        id: "r-bad",
        trigger: { type: "on_interact", objectId: "boton" },
        actions: [
          { type: "set_flag", flag: "parcial", value: true },
          { type: "consume_item", itemId: "fantasma" },
        ],
      }),
      makeRule({
        id: "r-good",
        trigger: { type: "on_interact", objectId: "boton" },
        actions: [{ type: "set_flag", flag: "buena", value: true }],
      }),
    ];
    const engine = createEngine(makeState(), rules);

    const result = engine.dispatch({ type: "on_interact", objectId: "boton" }, 0);

    expect(result.fired.map((f) => f.ruleId)).toEqual(["r-good"]);
    expect(result.aborted.map((a) => a.ruleId)).toEqual(["r-bad"]);
    expect(result.aborted[0]?.error).toContain("fantasma");
    expect(engine.state.flags.parcial).toBeUndefined();
    expect(engine.state.flags.buena).toBe(true);
    expect(engine.firedCount("r-bad")).toBe(0);
  });
});

describe("motor de reglas — once / repeatable", () => {
  it("una regla once dispara una sola vez; la repeatable cada vez", () => {
    const rules = [
      makeRule({
        id: "r-once",
        once: true,
        trigger: { type: "on_interact", objectId: "boton" },
        actions: [{ type: "set_flag", flag: "once", value: true }],
      }),
      makeRule({
        id: "r-repeatable",
        once: false,
        trigger: { type: "on_interact", objectId: "boton" },
        actions: [{ type: "set_flag", flag: "repeat", value: true }],
      }),
    ];
    const engine = createEngine(makeState(), rules);

    expect(firedIds(engine, { type: "on_interact", objectId: "boton" })).toEqual([
      "r-once",
      "r-repeatable",
    ]);
    expect(firedIds(engine, { type: "on_interact", objectId: "boton" })).toEqual(["r-repeatable"]);
    expect(engine.firedCount("r-once")).toBe(1);
    expect(engine.firedCount("r-repeatable")).toBe(2);
  });
});

describe("motor de reglas — delay y timers", () => {
  it("aplica las acciones de un delay solo al vencer el tiempo lógico", () => {
    const engine = createEngine(makeState(), [
      makeRule({
        id: "r-delay",
        trigger: { type: "on_interact", objectId: "palanca" },
        actions: [
          {
            type: "delay",
            seconds: 3,
            actions: [{ type: "set_flag", flag: "listo", value: true }],
          },
        ],
      }),
    ]);

    engine.dispatch({ type: "on_interact", objectId: "palanca" }, 0);
    expect(engine.state.flags.listo).toBeUndefined();

    engine.tick(2999);
    expect(engine.state.flags.listo).toBeUndefined();

    const result = engine.tick(3000);
    expect(engine.state.flags.listo).toBe(true);
    expect(result.effects).toContainEqual({ type: "set_flag", flag: "listo", value: true });
  });

  it("no duplica delays al repetir el mismo dispatch (idempotencia)", () => {
    const engine = createEngine(makeState(), [
      makeRule({
        id: "r-delay",
        trigger: { type: "on_interact", objectId: "palanca" },
        actions: [
          { type: "delay", seconds: 3, actions: [{ type: "set_flag", flag: "x", value: true }] },
        ],
      }),
    ]);

    engine.dispatch({ type: "on_interact", objectId: "palanca" }, 0);
    engine.dispatch({ type: "on_interact", objectId: "palanca" }, 0);

    expect(engine.state.deferred).toHaveLength(1);
  });

  it("dispara on_timer_end al agotarse un timer", () => {
    const engine = createEngine(makeState(), [
      makeRule({
        id: "r-start",
        trigger: { type: "on_interact", objectId: "inicio" },
        actions: [{ type: "start_timer", id: "t", durationSec: 10 }],
      }),
      makeRule({
        id: "r-end",
        trigger: { type: "on_timer_end", timerId: "t" },
        actions: [{ type: "set_flag", flag: "terminado", value: true }],
      }),
    ]);

    engine.dispatch({ type: "on_interact", objectId: "inicio" }, 0);
    engine.tick(9999);
    expect(engine.state.flags.terminado).toBeUndefined();

    const result = engine.tick(10000);
    expect(engine.state.flags.terminado).toBe(true);
    expect(result.fired.map((f) => f.ruleId)).toEqual(["r-end"]);
  });

  it("pause_timer congela la cuenta", () => {
    const engine = createEngine(makeState(), [
      makeRule({
        id: "r-start",
        trigger: { type: "on_interact", objectId: "inicio" },
        actions: [{ type: "start_timer", id: "t", durationSec: 10 }],
      }),
      makeRule({
        id: "r-pause",
        trigger: { type: "on_interact", objectId: "pausa" },
        actions: [{ type: "pause_timer", id: "t" }],
      }),
      makeRule({
        id: "r-end",
        trigger: { type: "on_timer_end", timerId: "t" },
        actions: [{ type: "set_flag", flag: "terminado", value: true }],
      }),
    ]);

    engine.dispatch({ type: "on_interact", objectId: "inicio" }, 0);
    engine.tick(5000);
    engine.dispatch({ type: "on_interact", objectId: "pausa" }, 5000);
    engine.tick(120000);

    expect(engine.state.timers.t?.running).toBe(false);
    expect(engine.state.flags.terminado).toBeUndefined();
  });

  it("un timer con regla on_timer es periódico", () => {
    const engine = createEngine(makeState(), [
      makeRule({
        id: "r-start",
        trigger: { type: "on_interact", objectId: "agua" },
        actions: [{ type: "start_timer", id: "agua", durationSec: 5 }],
      }),
      makeRule({
        id: "r-beat",
        once: false,
        trigger: { type: "on_timer", timerId: "agua" },
        actions: [{ type: "set_flag", flag: "sube", value: true }],
      }),
    ]);

    engine.dispatch({ type: "on_interact", objectId: "agua" }, 0);
    engine.tick(16000);

    expect(engine.firedCount("r-beat")).toBe(3);
  });

  // Regresión D-2 (auditoría 2026-09-24): un `durationSec` ínfimo en un timer
  // periódico generaba cientos de miles de eventos `on_timer` en un único
  // `tick`, colgando el proceso. El esquema ya exige `durationSec ≥ 1`, pero
  // el motor se defiende también por si acaso (`MAX_TIMER_EVENTS_PER_TICK`).
  it("un timer periódico con durationSec ínfimo no dispara sin límite en un solo tick", () => {
    const engine = createEngine(makeState(), [
      makeRule({
        id: "r-start",
        trigger: { type: "on_interact", objectId: "agua" },
        actions: [{ type: "start_timer", id: "agua", durationSec: 0.001 }],
      }),
      makeRule({
        id: "r-beat",
        once: false,
        trigger: { type: "on_timer", timerId: "agua" },
        actions: [{ type: "set_flag", flag: "sube", value: true }],
      }),
    ]);

    engine.dispatch({ type: "on_interact", objectId: "agua" }, 0);
    const start = Date.now();
    engine.tick(60_000);
    expect(Date.now() - start).toBeLessThan(1000);
    // 60s / 0.001s pediría 60 000 disparos; el tope por tick lo acota muy por debajo.
    expect(engine.firedCount("r-beat")).toBeLessThan(60_000);
  });

  it("dispara on_time_remaining_below al cruzar el umbral", () => {
    const engine = createEngine(makeState({ timeLimitSec: 60, startedAt: 0 }), [
      makeRule({
        id: "r-warn",
        trigger: { type: "on_time_remaining_below", seconds: 10 },
        actions: [{ type: "set_flag", flag: "aviso", value: true }],
      }),
    ]);

    engine.tick(40000);
    expect(engine.state.flags.aviso).toBeUndefined();

    engine.tick(50000);
    expect(engine.state.flags.aviso).toBe(true);
  });

  // Regresión (2026-09-25): el playtest de sala terminaba con `end_game: timeout`
  // nada más cargar. Si el estado inicial trae `lastTickAt: 0` (valor por
  // defecto cuando no se pasa `now`) pero `on_game_start` se dispatchea con un
  // `now` real (p. ej. `Date.now()`), el primer `tick` calculaba un delta de
  // ~décadas y agotaba de inmediato cualquier timer con `timeLimitSec`.
  // `on_game_start` debe fijar también `lastTickAt`, no solo `startedAt`.
  it("on_game_start fija lastTickAt además de startedAt, evitando un delta gigante en el primer tick", () => {
    const engine = createEngine(makeState({ timeLimitSec: 60 }), [
      makeRule({
        id: "r-tiempo-agotado",
        trigger: { type: "on_time_remaining_below", seconds: 0 },
        actions: [{ type: "end_game", result: "timeout" }],
      }),
    ]);

    const realNow = Date.now();
    engine.dispatch({ type: "on_game_start" }, realNow);
    const result = engine.tick(realNow + 250);

    expect(engine.state.result).toBeUndefined();
    expect(result.fired.map((f) => f.ruleId)).not.toContain("r-tiempo-agotado");
  });
});

describe("motor de reglas — encadenamiento e idempotencia", () => {
  it("una acción grant_item provoca reglas on_item_collected", () => {
    const engine = createEngine(makeState(), [
      makeRule({
        id: "r-dar",
        trigger: { type: "on_interact", objectId: "cofre" },
        actions: [{ type: "grant_item", itemId: "gema", to: "interactor" }],
      }),
      makeRule({
        id: "r-gema",
        trigger: { type: "on_item_collected", itemId: "gema" },
        actions: [{ type: "set_flag", flag: "tiene_gema", value: true }],
      }),
    ]);

    const ids = firedIds(engine, { type: "on_interact", objectId: "cofre", playerId: "p1" });

    expect(ids).toEqual(["r-dar", "r-gema"]);
    expect(engine.state.inventory.p1).toContain("gema");
    expect(engine.state.flags.tiene_gema).toBe(true);
  });

  it("corta el encadenamiento al alcanzar maxChainDepth", () => {
    const engine = createEngine(
      makeState(),
      [
        makeRule({
          id: "r-loop",
          once: false,
          trigger: { type: "on_item_collected", itemId: "bucle" },
          actions: [{ type: "grant_item", itemId: "bucle", to: "interactor" }],
        }),
      ],
      { maxChainDepth: 3 },
    );

    const result = engine.dispatch({ type: "on_item_collected", itemId: "bucle" }, 0);

    expect(result.depthExceeded).toBe(true);
    expect(engine.firedCount("r-loop")).toBeLessThanOrEqual(4);
  });

  it("repetir el mismo dispatch no cambia el estado", () => {
    const engine = createEngine(
      makeState(),
      [
        makeRule({
          id: "r-once",
          trigger: { type: "on_interact", objectId: "boton" },
          actions: [
            { type: "set_flag", flag: "a", value: 1 },
            { type: "grant_item", itemId: "moneda", to: "interactor" },
          ],
        }),
      ],
      { playerId: "p1" },
    );

    const event: GameEvent = { type: "on_interact", objectId: "boton", playerId: "p1" };
    engine.dispatch(event, 0);
    const afterFirst = engine.snapshot();

    const second = engine.dispatch(event, 0);

    expect(second.fired).toHaveLength(0);
    expect(engine.snapshot()).toEqual(afterFirst);
  });
});

describe("motor de reglas — inventario", () => {
  it("consume implícitamente los ítems con consumed: true y respeta consumed: false", () => {
    const engine = createEngine(
      createEngineState(),
      [
        makeRule({
          id: "r-usar",
          trigger: { type: "on_interact", objectId: "brasero" },
          conditions: [
            { type: "item_in_inventory", itemId: "antorcha", consumed: true },
            { type: "item_in_inventory", itemId: "caliz", consumed: false },
          ],
          actions: [{ type: "set_flag", flag: "encendido", value: true }],
        }),
      ],
      { playerId: "p1" },
    );

    engine.dispatch({ type: "on_interact", objectId: "brasero", playerId: "p1" }, 0);

    expect(engine.state.flags.encendido).toBe(true);
    expect(engine.state.inventory.p1).not.toContain("antorcha");
    expect(engine.state.inventory.p1).toContain("caliz");
  });

  it("grant_item a 'all' reparte a todos los jugadores", () => {
    const engine = createEngine(
      makeState({ inventory: { p1: [], p2: [] }, players: { p1: {}, p2: {} } }),
      [
        makeRule({
          id: "r-dar",
          trigger: { type: "on_interact", objectId: "altar" },
          actions: [{ type: "grant_item", itemId: "bendicion", to: "all" }],
        }),
      ],
    );

    engine.dispatch({ type: "on_interact", objectId: "altar", playerId: "p1" }, 0);

    expect(engine.state.inventory.p1).toContain("bendicion");
    expect(engine.state.inventory.p2).toContain("bendicion");
  });
});

function createEngineState(): GameState {
  return makeState({
    inventory: { p1: ["antorcha", "caliz"] },
    players: { p1: {} },
  });
}
