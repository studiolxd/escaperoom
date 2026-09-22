import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRoomPackage } from "@escaperoom/shared";
import { createHintState, requestHint, toHintPublicView } from "@escaperoom/shared/hints";
import es from "../messages/es.json";

/**
 * Integración del panel de pistas (ticket 1.8) contra el `RoomPackage` real del
 * Rey Aldric: el contador, los tiers y la resolución de texto viven en
 * `@escaperoom/shared/hints`; el panel solo pinta `HintPublicView`.
 */
const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const room = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")));
const totalHints = room.hints.reduce((sum, hint) => sum + hint.cost, 0);

describe("panel de pistas (ticket 1.8)", () => {
  it("el catálogo `es` expone la copy del panel", () => {
    expect(es.Hints.title).toBe("Pistas");
    expect(es.Hints.request).toBe("Pedir pista");
    expect(es.Hints.remaining).toContain("{count}");
    expect(es.Hints.errors.insufficient_hints).toContain("{remaining}");
  });

  it("pedir pista muestra el tier correcto y descuenta el contador", () => {
    const state = createHintState(room.hints, { totalHints });
    const result = requestHint(state, room.hints, "p-candado-arca");
    if (!result.ok) throw new Error("se esperaba un acierto");

    const view = toHintPublicView(result.state, room.hints, "es");
    const puzzle = view.puzzles.find((candidate) => candidate.puzzleId === "p-candado-arca");
    const expected = room.hints.find((hint) => hint.id === "hint-arca-1");

    expect(result.tier).toBe(1);
    expect(puzzle?.tier).toBe(1);
    expect(puzzle?.hints).toHaveLength(1);
    expect(puzzle?.hints[0]?.tier).toBe(1);
    expect(puzzle?.hints[0]?.text).toBe(expected?.text["es"]?.text);
    expect(puzzle?.nextCost).toBe(2);
    expect(view.remaining).toBe(totalHints - 1);
  });

  it("escala al tier 2 en una segunda petición", () => {
    const first = requestHint(createHintState(room.hints), room.hints, "p-candado-arca");
    if (!first.ok) throw new Error("se esperaba tier 1");
    const second = requestHint(first.state, room.hints, "p-candado-arca");
    if (!second.ok) throw new Error("se esperaba tier 2");

    const view = toHintPublicView(second.state, room.hints, "es");
    const puzzle = view.puzzles.find((candidate) => candidate.puzzleId === "p-candado-arca");
    expect(puzzle?.hints.map((hint) => hint.tier)).toEqual([1, 2]);
    expect(view.remaining).toBe(totalHints - 3);
  });

  it("rechaza con un código claro si el coste supera las pistas restantes", () => {
    const state = createHintState(room.hints, { totalHints: 0 });
    const result = requestHint(state, room.hints, "p-candado-arca");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("se esperaba un rechazo");
    expect(result.error.code).toBe("insufficient_hints");
    expect(result.error.message).toContain("solo quedan 0");
  });
});
