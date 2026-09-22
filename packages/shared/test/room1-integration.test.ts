import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EngineEffect, EngineResult } from "../src/engine";
import { parseRoomPackage } from "../src/schemas";
import {
  computeSessionStats,
  createRoomSession,
  type RoomInteractionResult,
  type RoomSession,
} from "../src/session";

/**
 * Test de integración de la **Sala 1 (Salón del Trono)** del Rey Aldric
 * (ticket 1.10). Recorre la sala de principio a fin usando las piezas reales,
 * sin infraestructura:
 *
 * - motor de reglas (1.4) vía `RoomSession`;
 * - plantillas `hidden_key` (1.5), `code_lock` (1.6) y `combine_items` (1.7);
 * - estado del mundo (`GameState`: objetos, flags, inventario, puzzles);
 * - fin de partida y stats (1.9).
 *
 * Guion: inspeccionar el cuadro → `llave-bronce` → abrir el armario →
 * `mechero`+`vela` → combinar → `antorcha` → encender el brasero → candado del
 * arca (código `4732`) → `caliz-real` → placas (puente en solitario con el
 * cáliz) → puerta a la Bodega.
 *
 * **La victoria es al final de las 3 salas** (`p-canal-agua` + `p-sello-final`
 * viven en las Catacumbas), así que este vertical no puede terminar en
 * `victory` por diseño. La aserción es, por tanto, «la Sala 1 se completa»
 * (puzzles resueltos + ítems esperados + estado del mundo), documentado en el
 * PR. No se inventa una victoria artificial.
 */

const fixturePath = fileURLToPath(
  new URL("../../../docs/reference/roompackage-rey-aldric.v1.json", import.meta.url),
);
const room = parseRoomPackage(JSON.parse(readFileSync(fixturePath, "utf8")) as unknown);
const TOTAL_PUZZLES = room.puzzles.length;

/** Sala 1 (Salón del Trono): puzzles que la completan. */
const SALA1_SOLVED = ["p-llave-cuadro", "p-candado-arca", "p-placas-estatuas"] as const;

function newSession(): RoomSession {
  return createRoomSession(room, {
    playerIds: ["p1"],
    timeLimitSec: 3600,
  });
}

interface ScriptResult {
  session: RoomSession;
  dialogs: string[];
  fired: string[];
}

/** Recorre la Sala 1 entera sobre una sesión nueva. */
function playSala1(): ScriptResult {
  const session = newSession();
  const dialogs: string[] = [];
  const fired: string[] = [];

  const collectEngine = (result: EngineResult): void => {
    fired.push(...result.fired.map((rule) => rule.ruleId));
    dialogs.push(
      ...result.effects
        .filter(
          (effect): effect is Extract<EngineEffect, { type: "show_dialog" }> =>
            effect.type === "show_dialog",
        )
        .map((effect) => effect.dialogId),
    );
  };
  const collectInteraction = (result: RoomInteractionResult): void => {
    collectEngine(result.engine);
  };

  collectEngine(session.start(0));

  collectInteraction(session.interact("cuadro-aurelio", 0));
  collectInteraction(session.useItemOnObject("llave-bronce", "armario", 0));
  const combined = session.combine("p-combina", ["mechero", "vela"], 0);
  if (combined.engine) collectEngine(combined.engine);
  collectInteraction(session.interact("brasero", 0));
  const lock = session.attemptCode("p-candado-arca", "4732", 0);
  if (lock.engine) collectEngine(lock.engine);
  const plates = session.solveWorldPuzzle("p-placas-estatuas", 0);
  if (plates) collectEngine(plates);

  return { session, dialogs, fired };
}

describe("integración — Sala 1 (Salón del Trono) del Rey Aldric", () => {
  it("se recorre de principio a fin y la sala queda completada", () => {
    const { session, dialogs, fired } = playSala1();
    const state = session.snapshot();

    // — Puzzles resueltos —
    for (const puzzleId of SALA1_SOLVED) {
      expect(state.puzzleStates[puzzleId]?.state, `${puzzleId} resuelto`).toBe("solved");
    }
    // `p-combina` es compartido con la Bodega/Catacumbas (su 2ª receta,
    // `llave-plata → llave-oro`, no se juega en el Salón): aquí basta con que la
    // receta del Salón (`mechero + vela → antorcha`) se haya aplicado.
    expect(session.combineItemsView("p-combina").appliedRecipeCount).toBeGreaterThanOrEqual(1);

    // — Ítems esperados: los consumibles se gastan, el cáliz y el pergamino quedan —
    expect(session.inventory()).toEqual(["caliz-real", "pergamino-bodega"]);
    expect(session.inventory()).not.toContain("llave-bronce");
    expect(session.inventory()).not.toContain("mechero");
    expect(session.inventory()).not.toContain("vela");
    expect(session.inventory()).not.toContain("antorcha");

    // — Estado del mundo —
    expect(session.objectState("cuadro-aurelio")).toBe("open");
    expect(session.objectState("armario")).toBe("open");
    expect(session.objectState("brasero")).toBe("lit");
    expect(session.objectState("arca-candado")).toBe("open");
    expect(session.objectState("puerta-bodega")).toBe("open");
    expect(session.flag("digito3")).toBe(3);
    expect(session.flag("game_started")).toBe(true);

    // — Timer e intro (reglas del motor) —
    expect(state.timers.cronometro?.running).toBe(true);
    expect(state.timers.cronometro?.durationSec).toBe(3600);
    expect(dialogs).toContain("d-intro");
    expect(dialogs).toContain("d-cuadro");
    expect(dialogs).toContain("d-brasero");
    expect(dialogs).toContain("d-pergamino");

    // — Reglas del Salón que deben haber disparado —
    expect(fired).toEqual(
      expect.arrayContaining([
        "r-inicio",
        "r-inspeccionar-cuadro",
        "r-revelar-cuadro",
        "r-abrir-armario",
        "r-encender-brasero",
        "r-abrir-arca",
        "r-leer-pergamino",
        "r-placas-resueltas",
      ]),
    );

    // — Fin de partida (1.9): sin victoria artificial, la sala sigue en curso —
    expect(state.result).toBeUndefined();
    expect(state.phase).toBe("playing");
    expect(session.summary(0)).toBeUndefined();

    // Stats de la proyección de 1.9 sobre el estado del Salón.
    expect(computeSessionStats(state, { now: 0, puzzlesTotal: TOTAL_PUZZLES })).toEqual({
      durationSec: 0,
      hintsUsed: 0,
      puzzlesSolved: SALA1_SOLVED.length,
      puzzlesTotal: TOTAL_PUZZLES,
      itemsCollected: 2,
    });
  });

  it("es idempotente: repetir el guion no cambia el estado", () => {
    const { session } = playSala1();
    const before = session.snapshot();
    const beforeViews = {
      hiddenKey: session.hiddenKeyView("p-llave-cuadro"),
      codeLock: session.codeLockView("p-candado-arca"),
      combine: session.combineItemsView("p-combina"),
    };

    // Replay del mismo guion sobre la sesión ya completada.
    session.start(0);
    session.interact("cuadro-aurelio", 0);
    session.useItemOnObject("llave-bronce", "armario", 0);
    session.combine("p-combina", ["mechero", "vela"], 0);
    session.interact("brasero", 0);
    session.attemptCode("p-candado-arca", "4732", 0);
    session.solveWorldPuzzle("p-placas-estatuas", 0);

    expect(session.snapshot()).toEqual(before);
    expect(session.hiddenKeyView("p-llave-cuadro")).toEqual(beforeViews.hiddenKey);
    expect(session.codeLockView("p-candado-arca")).toEqual(beforeViews.codeLock);
    expect(session.combineItemsView("p-combina")).toEqual(beforeViews.combine);
  });

  it("el código del arca se valida en la plantilla y no revela el código", () => {
    const session = newSession();
    session.start(0);
    session.interact("cuadro-aurelio", 0);
    session.useItemOnObject("llave-bronce", "armario", 0);
    session.combine("p-combina", ["mechero", "vela"], 0);
    session.interact("brasero", 0);

    const wrong = session.attemptCode("p-candado-arca", "0000", 0);
    expect(wrong.outcome).toBe("wrong");
    expect(session.isPuzzleSolved("p-candado-arca")).toBe(false);

    const correct = session.attemptCode("p-candado-arca", "4732", 0);
    expect(correct.outcome).toBe("correct");
    expect(session.isPuzzleSolved("p-candado-arca")).toBe(true);

    // La proyección pública nunca expone el código.
    const view = session.codeLockView("p-candado-arca");
    expect(JSON.stringify(view)).not.toContain("4732");
    expect(view).not.toHaveProperty("code");
  });
});
