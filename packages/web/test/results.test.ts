import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage } from "@escaperoom/shared";
import { createEngine, createInitialState } from "@escaperoom/shared/engine";
import { buildSessionSummary } from "@escaperoom/shared/session";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { formatDuration } from "../src/lib/session-format";

/**
 * Pantalla de resultados (ticket 1.9): el copy sale del catálogo `Results`, el
 * formato de duración es puro y la pantalla consume la proyección pública
 * `SessionSummary` de `@escaperoom/shared/session` (nunca el `GameState`).
 */
const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const room = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")));

describe("pantalla de resultados (ticket 1.9)", () => {
  it("el catálogo `es` expone la copy de resultados", () => {
    expect(es.Results.title).toBe("Resultados");
    expect(es.Results.result.victory).toBe("¡Victoria!");
    expect(es.Results.result.timeout).toBe("Se agotó el tiempo");
    expect(es.Results.result.aborted).toBe("Partida abandonada");
    expect(es.Results.puzzlesValue).toContain("{solved}");
    expect(es.Results.puzzlesValue).toContain("{total}");
    expect(en.Results.title).toBe("Results");
  });

  it("formatea la duración como mm:ss o h:mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65)).toBe("01:05");
    expect(formatDuration(3004.001)).toBe("50:04");
    expect(formatDuration(3600)).toBe("1:00:00");
  });

  it("consume la proyección pública del fin de partida", () => {
    const state = createInitialState(room, { playerIds: ["p1"], timeLimitSec: 3600 });
    const engine = createEngine(state, room.rules, { playerId: "p1" });
    engine.dispatch({ type: "on_game_start" }, 0);
    engine.tick(3_600_000);

    const summary = buildSessionSummary(engine.state, {
      now: 3_600_000,
      puzzlesTotal: room.puzzles.length,
      hintsUsed: 1,
    });

    expect(summary).toBeDefined();
    expect(summary?.result).toBe("timeout");
    expect(summary?.stats).toEqual({
      durationSec: 3600,
      hintsUsed: 1,
      puzzlesSolved: 0,
      puzzlesTotal: room.puzzles.length,
      itemsCollected: 0,
    });
    expect(formatDuration(summary?.stats.durationSec ?? 0)).toBe("1:00:00");
  });
});
