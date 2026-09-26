import { describe, expect, it } from "vitest";
import { elapsedMs, remainingMs } from "../src/session";
import type { GameSnapshot } from "../src/session";

/**
 * Ticket duración-salas (#169) + auditoría 2026-09-24 (F-43..47): `elapsedMs`
 * decidía "sin empezar" mirando si `startedAt` era *truthy*. En el cliente
 * local (`createLocalGameClient`), `startedAt` es tiempo lógico relativo a la
 * creación del cliente (`session/local.ts`), así que una partida que empieza
 * en el mismo instante en que se crea el cliente (habitual en tests
 * síncronos) tiene legítimamente `startedAt === 0` — el HUD dejaba de pintar
 * el tiempo transcurrido de forma intermitente (visto en CI, PR #174).
 */

function makeSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    selfId: "p1",
    phase: "playing",
    result: "",
    roomPackageId: "room-rey-aldric",
    roomPackageVersion: "1",
    hostId: "p1",
    clock: 0,
    startedAt: 0,
    endsAt: 0,
    players: [],
    self: null,
    objects: {},
    puzzles: {},
    inventory: [],
    inventories: {},
    flags: {},
    chat: [],
    ...overrides,
  };
}

describe("elapsedMs", () => {
  it("no es null cuando la partida empieza en el mismo instante en que se crea el cliente (startedAt: 0)", () => {
    const snapshot = makeSnapshot({ phase: "playing", clock: 0, startedAt: 0 });
    expect(elapsedMs(snapshot)).toBe(0);
  });

  it("null en el lobby, incluso si startedAt/clock ya tuvieran algún valor", () => {
    const snapshot = makeSnapshot({ phase: "lobby", clock: 500, startedAt: 200 });
    expect(elapsedMs(snapshot)).toBeNull();
  });

  it("tiempo jugado normal: clock - startedAt", () => {
    const snapshot = makeSnapshot({ phase: "playing", clock: 5_000, startedAt: 1_000 });
    expect(elapsedMs(snapshot)).toBe(4_000);
  });

  it("nunca negativo (reloj que aún no avanzó tras empezar)", () => {
    const snapshot = makeSnapshot({ phase: "playing", clock: 1_000, startedAt: 1_500 });
    expect(elapsedMs(snapshot)).toBe(0);
  });

  it("también tras terminar (phase: ended), no solo playing", () => {
    const snapshot = makeSnapshot({ phase: "ended", clock: 9_000, startedAt: 1_000 });
    expect(elapsedMs(snapshot)).toBe(8_000);
  });
});

describe("remainingMs (control: no debe verse afectado por el fix de elapsedMs)", () => {
  it("null sin límite de tiempo (endsAt: 0), aunque la partida esté en curso", () => {
    const snapshot = makeSnapshot({ phase: "playing", clock: 1_000, startedAt: 0, endsAt: 0 });
    expect(remainingMs(snapshot)).toBeNull();
  });

  it("ms restantes cuando sí hay límite", () => {
    const snapshot = makeSnapshot({ phase: "playing", clock: 1_000, startedAt: 0, endsAt: 5_000 });
    expect(remainingMs(snapshot)).toBe(4_000);
  });
});
