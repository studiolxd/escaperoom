import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRoomPackage, toRuntimeModel, type RoomPackage } from "../src/loader";
import {
  buildHintView,
  createLocalGameClient,
  stepsBetween,
  toGameSnapshot,
  toSessionSummary,
  type GameEvent,
  type GameRoomStateLike,
} from "../src/session";

/**
 * Capa de sesión del runtime (fase 2, cliente de red): la instantánea que se
 * deriva del room state, el cliente local que emula la `GameRoom` detrás de la
 * misma interfaz y las proyecciones puras de la UI. El cliente de red contra
 * una `GameRoom` real se prueba en `web` (que tiene el servidor como
 * devDependency).
 */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);

function reyAldric(): RoomPackage {
  return loadRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
}

/** `MapSchema`/`ArraySchema` de mentira: solo `forEach`, como los de Colyseus. */
function each<T>(entries: Record<string, T>) {
  return {
    forEach: (cb: (value: T, key: string) => void) =>
      Object.entries(entries).forEach(([k, v]) => cb(v, k)),
  };
}

describe("modelo público del runtime (campos de fase 2)", () => {
  const model = toRuntimeModel(reyAldric());

  it("deriva acciones de menú y panel por objeto sin exponer reglas", () => {
    expect(model.objectsById["cuadro-aurelio"]?.panelPuzzleId).toBe("p-llave-cuadro");
    expect(model.objectsById["mirilla-a"]?.panelPuzzleId).toBe("p-reja-mirillas");
    expect(model.objectsById["armario"]?.actions).toContain("use_item");
    expect(model.objectsById["brasero"]?.actions?.length).toBeGreaterThan(0);
  });

  it("publica la geometría de placas y mirillas y las pistas sin su texto", () => {
    expect(model.puzzlesById["p-placas-estatuas"]).toMatchObject({
      plates: [
        { objectId: "placa-izq", x: 6, y: 11 },
        { objectId: "placa-der", x: 14, y: 11 },
      ],
      soloBridgeItemId: "caliz-real",
    });
    expect(model.puzzlesById["p-reja-mirillas"]?.viewpoints).toEqual([
      { objectId: "mirilla-a", x: 9, y: 10 },
      { objectId: "mirilla-b", x: 13, y: 10 },
    ]);
    expect(model.hints?.length).toBeGreaterThan(0);
    for (const hint of model.hints ?? []) {
      expect(Object.keys(hint).sort()).toEqual(["cost", "puzzleId", "tier"]);
    }
  });

  it("el modelo serializado no contiene ningún código ni solución", () => {
    const pkg = reyAldric();
    const serialized = JSON.stringify(model);
    for (const puzzle of pkg.puzzles) {
      if (puzzle.type === "code_lock") expect(serialized).not.toContain(`"${puzzle.code}"`);
    }
    for (const key of ["solution", "seed", "pairs", "recipes", "fragments", "witness"]) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it("la paleta de las mirillas trae todos los glifos, ordenados y sin el orden de la pista", () => {
    // Sin ella, cada jugador solo podría teclear lo que ve desde su mirilla (ticket 6.5).
    const reja = model.puzzlesById["p-reja-mirillas"];
    expect(reja?.symbols).toEqual(["corona", "espada", "luna"]);
    const fragments = reyAldric().puzzles.find((puzzle) => puzzle.id === "p-reja-mirillas");
    expect(fragments?.type === "split_clue" && fragments.fragments).toEqual([
      "luna",
      "corona",
      "luna",
      "espada",
    ]);
  });
});

describe("toGameSnapshot", () => {
  it("aplana el room state para el jugador local y decodifica las flags", () => {
    const state: GameRoomStateLike = {
      phase: "playing",
      result: "",
      roomPackageId: "room-rey-aldric",
      roomPackageVersion: "1.0.0",
      startedAt: 1000,
      endsAt: 3_601_000,
      clock: 5000,
      hostId: "a",
      players: each({
        a: {
          id: "a",
          name: "Ana",
          x: 10,
          y: 12,
          roomId: "salon-trono",
          tint: "#38bdf8",
          connected: true,
        },
        b: {
          id: "b",
          name: "Bruno",
          x: 9,
          y: 12,
          roomId: "salon-trono",
          tint: "#f472b6",
          connected: true,
        },
      }),
      objects: each({ armario: "open" }),
      puzzles: each({ "p-candado-arca": { state: "available", attempts: 2, solvedBy: "" } }),
      inventories: each({ a: { items: ["vela"] }, b: { items: ["llave-bronce"] } }),
      flags: each({ digito3: "3", game_started: "true", raro: "{no-json" }),
      chat: [{ id: "1", authorId: "b", authorName: "Bruno", text: "hola", ts: 1, filtered: false }],
    };
    const snapshot = toGameSnapshot(state, "b");
    expect(snapshot.self).toMatchObject({ id: "b", name: "Bruno", isSelf: true, isHost: false });
    expect(snapshot.players.find((player) => player.id === "a")?.isHost).toBe(true);
    expect(snapshot.inventory).toEqual(["llave-bronce"]);
    expect(snapshot.flags).toEqual({ digito3: 3, game_started: true, raro: "{no-json" });
    expect(snapshot.puzzles["p-candado-arca"]?.attempts).toBe(2);
    expect(snapshot.chat.map((entry) => entry.text)).toEqual(["hola"]);
  });
});

describe("createLocalGameClient (misma interfaz que la red)", () => {
  function setup() {
    let now = 0;
    const client = createLocalGameClient(reyAldric(), { tickMs: false, now: () => now });
    const events: GameEvent[] = [];
    client.onEvent((event) => events.push(event));
    return { client, events, advance: (ms: number) => (now += ms) };
  }

  it("empieza en lobby y rechaza acciones hasta que el anfitrión arranca", () => {
    const { client, events } = setup();
    expect(client.getSnapshot().phase).toBe("lobby");
    client.interact("cuadro-aurelio");
    expect(events.at(-1)).toMatchObject({ type: "error", code: "INVALID_STATE" });

    client.startGame();
    expect(client.getSnapshot().phase).toBe("playing");
    expect(events).toContainEqual({ type: "dialog_show", dialogId: "d-intro" });
  });

  it("interactuar, abrir un panel e intentar un código produce los mismos mensajes que la GameRoom", () => {
    const { client, events } = setup();
    let snapshots = 0;
    client.subscribe(() => (snapshots += 1));
    client.startGame();
    client.interact("cuadro-aurelio");
    expect(events).toContainEqual({ type: "item_granted", playerId: "p1", itemId: "llave-bronce" });
    expect(client.getSnapshot().inventory).toEqual(["llave-bronce"]);

    client.openPuzzle("p-candado-arca");
    const view = events.find((event) => event.type === "puzzle_view");
    expect(view).toMatchObject({ puzzleId: "p-candado-arca", view: { type: "code_lock" } });
    expect(JSON.stringify(view)).not.toContain("4732");

    client.attempt("p-candado-arca", { code: "0000" });
    expect(events.at(-2)).toMatchObject({
      type: "attempt_result",
      ok: false,
      error: "wrong_code",
    });
    // Panel abierto: tras la acción se reenvía la vista.
    expect(events.at(-1)).toMatchObject({ type: "puzzle_view", puzzleId: "p-candado-arca" });
    expect(snapshots).toBeGreaterThan(0);
  });

  it("valida el salto máximo y el cruce por una puerta cerrada", () => {
    const { client, events } = setup();
    client.startGame();
    const self = client.getSnapshot().self!;
    client.move(self.x - 5, self.y);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "MOVE_TOO_FAST" });
    client.move(self.x, self.y + 1);
    expect(client.getSnapshot().self?.y).toBe(self.y + 1);
    client.move(0, 0, "bodega");
    expect(events.at(-1)).toMatchObject({ type: "error", code: "ROOM_LOCKED" });
  });

  it("chat local y medios «sin configurar»", () => {
    const { client, events } = setup();
    client.sendChat("hola equipo");
    expect(client.getSnapshot().chat.map((entry) => entry.text)).toEqual(["hola equipo"]);
    client.requestMediaToken();
    expect(events.at(-1)).toMatchObject({ type: "media_token", payload: { configured: false } });
  });
});

describe("proyecciones de la UI", () => {
  it("buildHintView cuenta tiers y coste con lo entregado", () => {
    const hints = [
      { puzzleId: "p1", tier: 1, cost: 1 },
      { puzzleId: "p1", tier: 2, cost: 2 },
      { puzzleId: "p2", tier: 1, cost: 1 },
    ];
    const view = buildHintView(hints, [{ puzzleId: "p1", tier: 1, text: "Mira el cuadro" }], "es");
    expect(view.remaining).toBe(3);
    expect(view.used).toBe(1);
    expect(view.puzzles[0]).toMatchObject({ puzzleId: "p1", tier: 1, totalTiers: 2, nextCost: 2 });
    expect(view.puzzles[0]?.hints[0]?.text).toBe("Mira el cuadro");
    expect(view.hasMore).toBe(true);
  });

  it("stepsBetween trocea por debajo del salto máximo", () => {
    const steps = stepsBetween({ x: 10, y: 12 }, { x: 6, y: 11 });
    expect(steps.at(-1)).toEqual({ x: 6, y: 11 });
    let from = { x: 10, y: 12 };
    for (const step of steps) {
      expect(Math.hypot(step.x - from.x, step.y - from.y)).toBeLessThanOrEqual(2.5);
      from = step;
    }
    expect(stepsBetween({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });

  it("toSessionSummary usa las stats del servidor y el resultado", () => {
    const { client } = (() => {
      const local = createLocalGameClient(reyAldric(), { tickMs: false });
      return { client: local };
    })();
    const summary = toSessionSummary(
      "victory",
      { durationSec: 90, hintsUsed: 1, puzzlesSolved: 8, puzzlesTotal: 8, itemsCollected: 9 },
      client.getSnapshot(),
    );
    expect(summary).toMatchObject({ result: "victory", stats: { durationSec: 90 } });
    expect(toSessionSummary("abandoned", null, client.getSnapshot()).result).toBe("aborted");
  });
});
