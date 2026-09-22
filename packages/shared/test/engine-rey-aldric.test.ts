import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine, createInitialState, type Engine, type GameEvent } from "../src/engine";
import { parseRoomPackage, type Rule } from "../src/schemas";

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

const roomPackage = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
const rules: Rule[] = roomPackage.rules;

function createRoomEngine(): Engine {
  const state = createInitialState(roomPackage, {
    playerIds: ["p1"],
    timeLimitSec: 3600,
  });
  return createEngine(state, rules, { playerId: "p1" });
}

describe("motor de reglas — Salón del Rey Aldric", () => {
  it("dispara las reglas del Salón en el orden correcto", () => {
    const engine = createRoomEngine();
    const order: string[] = [];
    const dispatch = (event: GameEvent, now = 0): void => {
      order.push(...engine.dispatch(event, now).fired.map((f) => f.ruleId));
    };
    const grant = (itemId: string, now = 0): void => {
      order.push(...engine.grantItem(itemId, "interactor", now).fired.map((f) => f.ruleId));
    };

    dispatch({ type: "on_game_start" });
    dispatch({ type: "on_interact", objectId: "cuadro-aurelio", playerId: "p1" });
    grant("llave-bronce");
    dispatch({ type: "on_use_item", objectId: "armario", itemId: "llave-bronce", playerId: "p1" });
    grant("antorcha");
    dispatch({ type: "on_interact", objectId: "brasero", playerId: "p1" });

    expect(order).toEqual([
      "r-inicio",
      "r-inspeccionar-cuadro",
      "r-abrir-armario",
      "r-encender-brasero",
    ]);
    expect(engine.state.flags.digito3).toBe(3);
    expect(engine.state.objectStates.brasero).toBe("lit");
    expect(engine.state.timers.cronometro?.running).toBe(true);
    expect(engine.state.inventory.p1).toContain("mechero");
    expect(engine.state.inventory.p1).toContain("vela");
    expect(engine.state.inventory.p1).not.toContain("llave-bronce");
    expect(engine.state.inventory.p1).not.toContain("antorcha");
  });

  it("es idempotente: repetir el dispatch no cambia el estado", () => {
    const engine = createRoomEngine();

    engine.dispatch({ type: "on_game_start" }, 0);
    engine.dispatch({ type: "on_interact", objectId: "cuadro-aurelio", playerId: "p1" }, 0);
    engine.grantItem("llave-bronce", "interactor", 0);
    engine.dispatch(
      { type: "on_use_item", objectId: "armario", itemId: "llave-bronce", playerId: "p1" },
      0,
    );
    engine.grantItem("antorcha", "interactor", 0);
    engine.dispatch({ type: "on_interact", objectId: "brasero", playerId: "p1" }, 0);

    const before = engine.snapshot();
    const replay: string[] = [];

    for (const event of [
      { type: "on_game_start" },
      { type: "on_interact", objectId: "cuadro-aurelio", playerId: "p1" },
      { type: "on_use_item", objectId: "armario", itemId: "llave-bronce", playerId: "p1" },
      { type: "on_interact", objectId: "brasero", playerId: "p1" },
    ] satisfies GameEvent[]) {
      replay.push(...engine.dispatch(event, 0).fired.map((f) => f.ruleId));
    }

    expect(replay).toEqual([]);
    expect(engine.snapshot()).toEqual(before);
  });
});

describe("motor de reglas — ruta crítica del Rey Aldric", () => {
  it("recorre la sala hasta la victoria respetando orden y delay", () => {
    const engine = createRoomEngine();
    const order: string[] = [];
    const dispatch = (event: GameEvent, now: number): void => {
      order.push(...engine.dispatch(event, now).fired.map((f) => f.ruleId));
    };
    const grant = (itemId: string, now: number): void => {
      order.push(...engine.grantItem(itemId, "interactor", now).fired.map((f) => f.ruleId));
    };

    dispatch({ type: "on_game_start" }, 0);
    dispatch({ type: "on_interact", objectId: "cuadro-aurelio", playerId: "p1" }, 0);
    grant("llave-bronce", 0);
    dispatch(
      { type: "on_use_item", objectId: "armario", itemId: "llave-bronce", playerId: "p1" },
      0,
    );
    grant("antorcha", 0);
    dispatch({ type: "on_interact", objectId: "brasero", playerId: "p1" }, 0);

    grant("caliz-real", 0);
    grant("pergamino-bodega", 0);
    dispatch({ type: "on_puzzle_solved", puzzleId: "p-candado-arca", playerId: "p1" }, 0);

    grant("llave-plata", 0);
    dispatch({ type: "on_puzzle_solved", puzzleId: "p-mural-vendimia", playerId: "p1" }, 0);
    dispatch({ type: "on_interact", objectId: "mural-ranura", playerId: "p1" }, 0);

    engine.state.puzzleStates["p-placas-estatuas"] = { state: "solved", attempts: 1, solvedAt: 0 };
    dispatch({ type: "on_interact", objectId: "mural-ranura", playerId: "p1" }, 0);

    engine.state.puzzleStates["p-copas-memoria"] = { state: "solved", attempts: 1, solvedAt: 0 };
    dispatch({ type: "on_puzzle_solved", puzzleId: "p-copas-memoria", playerId: "p1" }, 0);

    dispatch({ type: "on_enter_room", roomId: "catacumbas", playerId: "p1" }, 0);
    dispatch({ type: "on_interact", objectId: "sarcofago", playerId: "p1" }, 0);
    dispatch({ type: "on_interact", objectId: "vasijas", playerId: "p1" }, 0);
    dispatch({ type: "on_puzzle_solved", puzzleId: "p-canal-agua", playerId: "p1" }, 0);

    order.push(...engine.tick(3_000_000).fired.map((f) => f.ruleId));

    dispatch({ type: "on_puzzle_solved", puzzleId: "p-sello-final", playerId: "p1" }, 3_000_001);
    expect(engine.state.result).toBeUndefined();

    engine.tick(3_004_001);

    expect(engine.state.result).toBe("victory");
    expect(engine.state.objectStates.altar).toBe("flowing");
    expect(engine.state.objectStates.relicario).toBe("open");
    expect(order).toEqual([
      "r-inicio",
      "r-inspeccionar-cuadro",
      "r-abrir-armario",
      "r-encender-brasero",
      "r-leer-pergamino",
      "r-abrir-arca",
      "r-mural-resuelto",
      "r-caliz-en-ranura",
      "r-recoger-caliz",
      "r-copas-resueltas",
      "r-entrar-catacumbas",
      "r-inspeccionar-sarcofago",
      "r-inspeccionar-vasijas",
      "r-canal-resuelto",
      "r-aviso-10min",
      "r-sello-resuelto",
    ]);
  });
});
