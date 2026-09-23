import type { RoomSession } from "@escaperoom/shared/session";

/**
 * Ruta crítica del Rey Aldric (14 pasos, `docs/reference/rey-aldric-notas-diseno.md`)
 * derivada del estado **real** de `RoomSession`: el playtest la pinta como
 * checklist, sin llevar un guion paralelo. Lógica pura para poder probarla sin
 * DOM ni Phaser.
 */

export const REY_ALDRIC_STEP_IDS = [
  "cuadro",
  "armario",
  "antorcha",
  "brasero",
  "arca",
  "placas",
  "mural",
  "llaveOro",
  "ranura",
  "copas",
  "mirillas",
  "canal",
  "sarcofago",
  "sello",
] as const;

export type ReyAldricStepId = (typeof REY_ALDRIC_STEP_IDS)[number];

export interface ReyAldricStep {
  id: ReyAldricStepId;
  done: boolean;
}

const COMBINE_PUZZLE = "p-combina";

type SessionReader = Pick<
  RoomSession,
  "isPuzzleSolved" | "objectState" | "flag" | "state" | "combineItemsView"
>;

function ruleFired(session: SessionReader, ruleId: string): boolean {
  return (session.state.ruleRuns[ruleId]?.count ?? 0) > 0;
}

/** Estado de cada paso de la ruta crítica con el estado actual de la sesión. */
export function reyAldricSteps(session: SessionReader): ReyAldricStep[] {
  const recipes = session.combineItemsView(COMBINE_PUZZLE).appliedRecipeCount;
  const done: Record<ReyAldricStepId, boolean> = {
    cuadro: session.isPuzzleSolved("p-llave-cuadro"),
    armario: session.objectState("armario") === "open",
    antorcha: recipes >= 1,
    brasero: session.objectState("brasero") === "lit",
    arca: session.isPuzzleSolved("p-candado-arca"),
    placas: session.isPuzzleSolved("p-placas-estatuas"),
    mural: session.isPuzzleSolved("p-mural-vendimia"),
    llaveOro: recipes >= 2,
    ranura: ruleFired(session, "r-caliz-en-ranura"),
    copas: session.isPuzzleSolved("p-copas-memoria"),
    mirillas: session.isPuzzleSolved("p-reja-mirillas"),
    canal: session.isPuzzleSolved("p-canal-agua") && session.objectState("altar") === "flowing",
    sarcofago: session.flag("digito4") === 8 && ruleFired(session, "r-inspeccionar-sarcofago"),
    sello: session.isPuzzleSolved("p-sello-final"),
  };
  return REY_ALDRIC_STEP_IDS.map((id) => ({ id, done: done[id] }));
}
