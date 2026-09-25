/**
 * Constantes compartidas por el motor (`engine.ts`, `state.ts`) y el modelo
 * del validador (`validator/model.ts`), que simula el mismo motor (D-22):
 * antes eran strings mágicos repetidos en varios ficheros.
 */

/** Flags reservadas que el propio motor escribe (specs/05 §1.2). */
export const RESERVED_FLAGS = {
  GAME_STARTED: "game_started",
  GAME_ENDED: "game_ended",
  TIME_REMAINING: "time_remaining",
} as const;

/** Estado de `objectStates` que deja un `unlock_door` (y que el validador comprueba). */
export const OPEN_OBJECT_STATE = "open";

/** `ruleId` sintético del efecto puntual `RuleEngine.grantItem` (no viene de ninguna `Rule`). */
export const GRANT_ITEM_RULE_ID = "__grant_item__";
