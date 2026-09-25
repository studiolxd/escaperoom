import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine, createInitialState, type GameEvent } from "../src/engine";
import { parseRoomPackage, RuleTriggerSchema } from "../src/schemas";
import { createRoomSession, type RoomSession } from "../src/session";

/**
 * Ticket 1.13 — interacción item ↔ objeto del mundo.
 *
 * Cubre, sin infraestructura:
 * - el vocabulario `on_use_item` en el Zod (y el fixture del Rey Aldric que lo usa);
 * - el motor de reglas disparando `on_use_item` de forma exacta e idempotente;
 * - `RoomSession.useItemOnObject` en sus tres vías lógicas (con llave, sin llave,
 *   repetido/idempotente);
 * - que inspeccionar el cuadro dos veces **no repite** el diálogo "encontrado".
 */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const room = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);

function newSession(): RoomSession {
  return createRoomSession(room, { playerIds: ["p1"], timeLimitSec: 3600 });
}

describe("vocabulario on_use_item", () => {
  it("el Zod acepta {objectId, itemId} y exige ambos", () => {
    expect(
      RuleTriggerSchema.safeParse({
        type: "on_use_item",
        objectId: "armario",
        itemId: "llave-bronce",
      }).success,
    ).toBe(true);
    expect(RuleTriggerSchema.safeParse({ type: "on_use_item", objectId: "armario" }).success).toBe(
      false,
    );
    expect(
      RuleTriggerSchema.safeParse({ type: "on_use_item", itemId: "llave-bronce" }).success,
    ).toBe(false);
  });

  it("el fixture del Rey Aldric usa on_use_item en la regla del armario", () => {
    const rule = room.rules.find((candidate) => candidate.id === "r-abrir-armario");
    expect(rule?.trigger).toEqual({
      type: "on_use_item",
      objectId: "armario",
      itemId: "llave-bronce",
    });
  });
});

describe("motor de reglas — on_use_item", () => {
  function newEngine() {
    const state = createInitialState(room, { playerIds: ["p1"], now: 0 });
    return createEngine(state, room.rules, { playerId: "p1" });
  }

  it("dispara la regla solo con el item y el objeto exactos", () => {
    const engine = newEngine();
    engine.grantItem("llave-bronce", "interactor", 0);

    const wrongItem = engine.dispatch(
      { type: "on_use_item", itemId: "antorcha", objectId: "armario", playerId: "p1" },
      0,
    );
    expect(wrongItem.fired.map((fired) => fired.ruleId)).not.toContain("r-abrir-armario");
    expect(engine.state.inventory.p1).toContain("llave-bronce");

    const ok = engine.dispatch(
      { type: "on_use_item", itemId: "llave-bronce", objectId: "armario", playerId: "p1" },
      0,
    );
    expect(ok.fired.map((fired) => fired.ruleId)).toEqual(["r-abrir-armario"]);
    expect(engine.state.objectStates.armario).toBe("open");
    expect(engine.state.inventory.p1).toContain("yesquero");
    expect(engine.state.inventory.p1).toContain("vela");
    expect(engine.state.inventory.p1).not.toContain("llave-bronce");
  });

  it("es idempotente: repetir el evento no cambia el estado", () => {
    const engine = newEngine();
    engine.grantItem("llave-bronce", "interactor", 0);
    const event: GameEvent = {
      type: "on_use_item",
      itemId: "llave-bronce",
      objectId: "armario",
      playerId: "p1",
    };
    engine.dispatch(event, 0);

    const before = engine.snapshot();
    const replay = engine.dispatch(event, 0);

    expect(replay.fired).toEqual([]);
    expect(engine.snapshot()).toEqual(before);
  });
});

describe("RoomSession.useItemOnObject — tres vías lógicas", () => {
  it("con la llave: abre el armario y otorga yesquero + vela", () => {
    const session = newSession();
    session.start(0);
    session.interact("cuadro-aurelio", 0);

    const result = session.useItemOnObject("llave-bronce", "armario", 0);

    expect(result.engine.fired.map((fired) => fired.ruleId)).toEqual(["r-abrir-armario"]);
    expect(session.objectState("armario")).toBe("open");
    expect(session.inventory()).toEqual(["yesquero", "vela"]);
  });

  it("sin la llave: no hace nada", () => {
    const session = newSession();
    session.start(0);

    const result = session.useItemOnObject("llave-bronce", "armario", 0);

    expect(result.engine.fired).toEqual([]);
    expect(session.objectState("armario")).toBe("closed");
    expect(session.inventory()).toEqual([]);
  });

  it("segunda vez: idempotente (no repite grants ni estado)", () => {
    const session = newSession();
    session.start(0);
    session.interact("cuadro-aurelio", 0);
    session.useItemOnObject("llave-bronce", "armario", 0);

    const before = session.snapshot();
    const second = session.useItemOnObject("llave-bronce", "armario", 0);

    expect(second.engine.fired).toEqual([]);
    expect(second.engine.effects).toEqual([]);
    expect(session.snapshot()).toEqual(before);
  });
});

describe("inspeccionar el cuadro dos veces", () => {
  it("no repite el diálogo ni vuelve a entregar la llave", () => {
    const session = newSession();
    session.start(0);

    const first = session.interact("cuadro-aurelio", 0);
    expect(first.dialogIds).toEqual(["d-cuadro"]);
    expect(session.inventory()).toEqual(["llave-bronce"]);

    const second = session.interact("cuadro-aurelio", 0);
    expect(second.dialogIds).toEqual([]);
    expect(second.engine.fired).toEqual([]);
    expect(session.inventory()).toEqual(["llave-bronce"]);
  });
});

describe("RoomSession.availableActions — menú derivado del motor", () => {
  it("deriva las acciones de las reglas declaradas para el objeto", () => {
    const session = newSession();
    // El armario solo declara `on_use_item`: el menú ofrece únicamente "Usar objeto…".
    expect(session.availableActions("armario")).toEqual(["use_item"]);
    // El cuadro solo declara `on_interact`: el menú ofrece "Inspeccionar".
    expect(session.availableActions("cuadro-aurelio")).toEqual(["inspect"]);
  });

  it("cae al set base si el objeto no declara ninguna regla", () => {
    const session = newSession();
    expect(session.availableActions("trono")).toEqual(["inspect", "use_item"]);
  });
});
