import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GridSchema,
  MAX_ACTIONS_PER_LIST,
  MAX_DELAY_DEPTH,
  MAX_GRID_DIMENSION,
  MAX_PLAYERS_PER_ROOM_CEILING,
  RoomPackageSchema,
  RuleActionSchema,
  type RuleAction,
} from "../src/schemas";

/**
 * Regresión D-1/D-2/D-11 (auditoría 2026-09-24): un `RoomPackage` hostil no
 * debe poder tumbar el validador — los topes de tamaño deben fallar rápido en
 * el propio `parse`, no en tiempo de ejecución del validador/motor.
 */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

function loadFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
}

/** Construye una cadena de `delay` anidados `depth` niveles de profundidad. */
function nestedDelay(depth: number): RuleAction {
  let action: RuleAction = { type: "set_flag", flag: "f", value: true };
  for (let i = 0; i < depth; i += 1) {
    action = { type: "delay", seconds: 1, actions: [action] };
  }
  return action;
}

describe("topes de tamaño del formato RoomPackage (D-1)", () => {
  it("el fixture del Rey Aldric sigue validando con los topes nuevos", () => {
    const result = RoomPackageSchema.safeParse(loadFixture());
    expect(result.success).toBe(true);
  });

  it("rechaza una rejilla gigante (define_subrooms / sliding_puzzle / pipes)", () => {
    expect(GridSchema.safeParse({ cols: 3000, rows: 3000 }).success).toBe(false);
    expect(
      GridSchema.safeParse({ cols: MAX_GRID_DIMENSION, rows: MAX_GRID_DIMENSION }).success,
    ).toBe(true);
  });

  it("rechaza players.max por encima del techo de la plataforma", () => {
    const pkg = loadFixture();
    const meta = pkg.meta as Record<string, unknown>;
    const hostile = {
      ...pkg,
      meta: { ...meta, players: { min: 1, max: 1_000_000_000 } },
    };
    const result = RoomPackageSchema.safeParse(hostile);
    expect(result.success).toBe(false);
  });

  it("un players.max dentro del techo sigue aceptándose", () => {
    const pkg = loadFixture();
    const meta = pkg.meta as Record<string, unknown>;
    const ok = {
      ...pkg,
      meta: { ...meta, players: { min: 1, max: MAX_PLAYERS_PER_ROOM_CEILING } },
    };
    expect(RoomPackageSchema.safeParse(ok).success).toBe(true);
  });

  it("rechaza un array de objetos descomunal sin colgarse", () => {
    const pkg = loadFixture();
    const objects = pkg.objects as Record<string, unknown>[];
    const hostile = {
      ...pkg,
      objects: Array.from({ length: 50_000 }, (_, i) => ({ ...objects[0], id: `o-${i}` })),
    };
    const start = Date.now();
    const result = RoomPackageSchema.safeParse(hostile);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.success).toBe(false);
  });
});

describe("profundidad de delay (D-11)", () => {
  it("acepta delay anidado hasta MAX_DELAY_DEPTH", () => {
    const result = RuleActionSchema.safeParse(nestedDelay(MAX_DELAY_DEPTH));
    expect(result.success).toBe(true);
  });

  it("rechaza delay anidado por encima de MAX_DELAY_DEPTH sin desbordar la pila", () => {
    // Muy por encima del tope: si el esquema recursara sin fondo (z.lazy),
    // este `safeParse` reventaría la pila en vez de devolver un error.
    const start = Date.now();
    const result = RuleActionSchema.safeParse(nestedDelay(5000));
    expect(Date.now() - start).toBeLessThan(2000);
    expect(result.success).toBe(false);
  });

  it("rechaza más de MAX_ACTIONS_PER_LIST acciones en una lista de delay", () => {
    const tooMany: RuleAction = {
      type: "delay",
      seconds: 1,
      actions: Array.from({ length: MAX_ACTIONS_PER_LIST + 1 }, () => ({
        type: "set_flag",
        flag: "f",
        value: true,
      })),
    };
    expect(RuleActionSchema.safeParse(tooMany).success).toBe(false);
  });
});
