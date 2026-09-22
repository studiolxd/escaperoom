import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine, createInitialState, type Engine, type GameEvent } from "../src/engine";
import { parseRoomPackage, type Rule } from "../src/schemas";
import {
  buildSessionSummary,
  computeSessionStats,
  endSession,
  isTimerExpired,
  resolveSessionResult,
} from "../src/session";

/**
 * Fin de partida (specs/04 §6, ticket 1.9) contra el `RoomPackage` real del Rey
 * Aldric: el motor dispara las reglas de victoria/timeout y esta capa proyecta
 * el resultado y las stats. Sin infraestructura.
 */
const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const room = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
const rules: Rule[] = room.rules;
const TOTAL_PUZZLES = room.puzzles.length;
const VICTORY_AT_MS = 3_004_001;

function createRoomEngine(): Engine {
  const state = createInitialState(room, { playerIds: ["p1"], timeLimitSec: 3600 });
  return createEngine(state, rules, { playerId: "p1" });
}

function solve(engine: Engine, puzzleId: string, now: number): void {
  engine.state.puzzleStates[puzzleId] = { state: "solved", attempts: 1, solvedAt: now };
  engine.dispatch({ type: "on_puzzle_solved", puzzleId, playerId: "p1" } satisfies GameEvent, now);
}

/** Recorre la sala hasta la victoria (misma ruta crítica que el motor 1.4). */
function playToVictory(): Engine {
  const engine = createRoomEngine();
  const dispatch = (event: GameEvent, now = 0): void => {
    engine.dispatch(event, now);
  };
  const grant = (itemId: string, now = 0): void => {
    engine.grantItem(itemId, "interactor", now);
  };

  dispatch({ type: "on_game_start" });
  dispatch({ type: "on_interact", objectId: "cuadro-aurelio", playerId: "p1" });
  grant("llave-bronce");
  dispatch({ type: "on_use_item", objectId: "armario", itemId: "llave-bronce", playerId: "p1" });
  grant("antorcha");
  dispatch({ type: "on_interact", objectId: "brasero", playerId: "p1" });

  grant("caliz-real");
  grant("pergamino-bodega");
  solve(engine, "p-candado-arca", 0);

  grant("llave-plata");
  solve(engine, "p-mural-vendimia", 0);
  dispatch({ type: "on_interact", objectId: "mural-ranura", playerId: "p1" });

  solve(engine, "p-placas-estatuas", 0);
  dispatch({ type: "on_interact", objectId: "mural-ranura", playerId: "p1" });

  solve(engine, "p-copas-memoria", 0);

  dispatch({ type: "on_enter_room", roomId: "catacumbas", playerId: "p1" });
  dispatch({ type: "on_interact", objectId: "sarcofago", playerId: "p1" });
  dispatch({ type: "on_interact", objectId: "vasijas", playerId: "p1" });
  solve(engine, "p-canal-agua", 0);

  engine.tick(3_000_000);
  solve(engine, "p-sello-final", 3_000_001);
  engine.tick(VICTORY_AT_MS);
  return engine;
}

describe("fin de partida — resultado", () => {
  it("un flujo completo termina en victoria", () => {
    const engine = playToVictory();

    expect(engine.state.result).toBe("victory");
    expect(resolveSessionResult(engine.state)).toBe("victory");

    const summary = buildSessionSummary(engine.state, { puzzlesTotal: TOTAL_PUZZLES });
    expect(summary?.result).toBe("victory");
    expect(summary?.endedAt).toBe(VICTORY_AT_MS);
  });

  it("el cronómetro a 0 termina en timeout", () => {
    const engine = createRoomEngine();
    engine.dispatch({ type: "on_game_start" }, 0);

    engine.tick(3_600_000);

    expect(engine.state.result).toBe("timeout");
    expect(isTimerExpired(engine.state)).toBe(true);

    const summary = buildSessionSummary(engine.state, {
      now: 3_600_000,
      puzzlesTotal: TOTAL_PUZZLES,
    });
    expect(summary?.result).toBe("timeout");
    expect(summary?.stats.durationSec).toBe(3600);
  });
});

describe("fin de partida — stats", () => {
  it("cuenta tiempo, puzzles resueltos/total, ítems y pistas", () => {
    const engine = playToVictory();
    const summary = buildSessionSummary(engine.state, {
      puzzlesTotal: TOTAL_PUZZLES,
      hintsUsed: 3,
    });

    expect(summary?.stats).toEqual({
      durationSec: VICTORY_AT_MS / 1000,
      hintsUsed: 3,
      puzzlesSolved: 6,
      puzzlesTotal: TOTAL_PUZZLES,
      itemsCollected: 5,
    });
    expect(summary?.solvedPuzzles).toEqual([
      "p-candado-arca",
      "p-placas-estatuas",
      "p-mural-vendimia",
      "p-copas-memoria",
      "p-canal-agua",
      "p-sello-final",
    ]);
    expect(summary?.items).toContain("caliz-real");
    expect(summary?.items).not.toContain("llave-bronce");
    expect(summary?.items).not.toContain("antorcha");
  });

  it("por defecto toma las pistas de `GameState.hintsUsed`", () => {
    const engine = playToVictory();
    engine.state.hintsUsed = { "p-candado-arca": 2, "p-sello-final": 1 };

    expect(computeSessionStats(engine.state).hintsUsed).toBe(3);
  });

  it("deriva el timeout por cronómetro aunque ninguna regla lo cierre", () => {
    const state = createInitialState(room, { playerIds: ["p1"], timeLimitSec: 60 });
    state.flags.game_started = true;
    state.phase = "playing";
    state.lastTickAt = 60_000;

    expect(resolveSessionResult(state, { now: 60_000 })).toBe("timeout");
  });
});

describe("fin de partida — idempotencia", () => {
  it("cerrar dos veces no cambia el resultado ni las stats", () => {
    const state = createInitialState(room, { playerIds: ["p1"], timeLimitSec: 3600 });
    state.flags.game_started = true;
    state.phase = "playing";

    const first = endSession(state, "aborted", 1_000);
    expect(first.result).toBe("abandoned");
    expect(first.phase).toBe("ended");
    expect(first.endedAt).toBe(1_000);
    expect(buildSessionSummary(first, { puzzlesTotal: TOTAL_PUZZLES })?.result).toBe("aborted");

    const second = endSession(first, "victory", 5_000);
    expect(second).toBe(first);
    expect(second.result).toBe("abandoned");
    expect(second.endedAt).toBe(1_000);
    expect(buildSessionSummary(second, { puzzlesTotal: TOTAL_PUZZLES })).toEqual(
      buildSessionSummary(first, { puzzlesTotal: TOTAL_PUZZLES }),
    );
  });

  it("no cierra una partida ya ganada", () => {
    const engine = playToVictory();
    const before = buildSessionSummary(engine.state);

    const after = endSession(engine.state, "timeout", 9_999_999);

    expect(after).toBe(engine.state);
    expect(buildSessionSummary(after)).toEqual(before);
  });
});
