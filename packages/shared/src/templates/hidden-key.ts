import type { HiddenKeyDefinition, PuzzleState } from "../schemas";
import { guardPlayable, initialPuzzleState } from "./base";

/**
 * Plantilla `hidden_key` (specs/06 §2.1). El escondite pasa de `locked` a
 * `available` y, al revelarlo, a `solved`; el reveal otorga el objeto escondido
 * (`keyItemId` o, si no se declara, el primer `grantsItems`).
 *
 * Como `code_lock.ts`, la lógica es pura: `revealHiddenKey` no muta `state` y
 * devuelve un estado nuevo, de modo que el host (Colyseus/React) decide cuándo
 * persistirlo y los tests corren sin infraestructura. La proyección
 * `toHiddenKeyPublicView` oculta el objeto hasta que el reveal ocurre.
 */

/** Estado interno de un `hidden_key` (nunca sale al cliente tal cual). */
export interface HiddenKeyState {
  /** `locked` si hay `requiresSolved` pendientes; `available` si ya se puede revelar. */
  state: PuzzleState;
  /** Instante ms del reveal, o ausente mientras siga oculto. */
  revealedAt?: number;
  /** Autor del reveal, si el host lo registra. */
  revealedBy?: string;
}

/** Resultado que el servidor devuelve tras revelar el escondite. */
export type HiddenKeyRevealOutcome = "revealed" | "already_revealed" | "unavailable";

export interface HiddenKeyRevealResult {
  outcome: HiddenKeyRevealOutcome;
  /** Estado resultante (nuevo objeto; `state` de entrada no se muta). */
  state: HiddenKeyState;
  /** Objeto que otorga este reveal; `null` si no aplica o ya estaba revelado. */
  grantedItemId: string | null;
}

/**
 * Proyección que viaja al cliente: lo justo para que el panel pinte el
 * escondite antes y después del reveal. **No** incluye `keyItemId` ni
 * `grantsItems`: `itemId` solo aparece cuando el escondite ya fue revelado.
 */
export interface HiddenKeyPublicView {
  id: string;
  type: "hidden_key";
  state: PuzzleState;
  hidingSpot: HiddenKeyDefinition["hidingSpot"];
  revealAnimation: HiddenKeyDefinition["revealAnimation"];
  revealed: boolean;
  revealedAt: number | null;
  revealedBy: string | null;
  /** Objeto escondido, visible solo tras el reveal; `null` mientras tanto. */
  itemId: string | null;
}

/** Objeto que entrega el escondite: `keyItemId` o el primer `grantsItems`. */
export function hiddenKeyGrantedItem(def: HiddenKeyDefinition): string | null {
  return def.keyItemId ?? def.grantsItems[0] ?? null;
}

/** Un escondite con `requiresSolved` pendiente arranca `locked`; si no, `available`. */
export function createHiddenKeyState(def: HiddenKeyDefinition): HiddenKeyState {
  return { state: initialPuzzleState(def.requiresSolved) };
}

/** `true` si el escondite ya fue revelado (aunque el estado aún no se sincronice). */
export function isHiddenKeyRevealed(state: HiddenKeyState): boolean {
  return state.state === "solved" || state.revealedAt !== undefined;
}

/**
 * Revela el escondite una única vez: marca `solved`, estampa `revealedAt` y
 * otorga el objeto. Es idempotente: un segundo reveal no vuelve a otorgar nada.
 */
export function revealHiddenKey(
  state: HiddenKeyState,
  def: HiddenKeyDefinition,
  now: number,
  revealedBy?: string,
): HiddenKeyRevealResult {
  if (isHiddenKeyRevealed(state)) {
    return { outcome: "already_revealed", state, grantedItemId: null };
  }
  if (guardPlayable(state.state) !== null) {
    return { outcome: "unavailable", state, grantedItemId: null };
  }

  const next: HiddenKeyState = {
    ...state,
    state: "solved",
    revealedAt: now,
    ...(revealedBy !== undefined ? { revealedBy } : {}),
  };
  return { outcome: "revealed", state: next, grantedItemId: hiddenKeyGrantedItem(def) };
}

/**
 * Proyección pública: no filtra el objeto ni los `grantsItems` antes del reveal.
 * Se prefija con `HiddenKey` para no colisionar con `code-lock.ts` (y futuras
 * plantillas) al reexportarse desde el barrel `templates`.
 */
export function toHiddenKeyPublicView(
  state: HiddenKeyState,
  def: HiddenKeyDefinition,
): HiddenKeyPublicView {
  const revealed = isHiddenKeyRevealed(state);
  return {
    id: def.id,
    type: "hidden_key",
    state: state.state,
    hidingSpot: { ...def.hidingSpot },
    revealAnimation: def.revealAnimation,
    revealed,
    revealedAt: state.revealedAt ?? null,
    revealedBy: state.revealedBy ?? null,
    itemId: revealed ? hiddenKeyGrantedItem(def) : null,
  };
}

/**
 * Comprobación simple para el validador futuro: hay un objeto que otorgar y el
 * estado aún puede resolverse. Un escondite ya revelado siempre es resoluble.
 */
export function isHiddenKeySolvableGiven(state: HiddenKeyState, def: HiddenKeyDefinition): boolean {
  if (state.state === "solved") return true;
  if (state.state === "failed") return false;
  return isCoherentHiddenKeyDefinition(def);
}

/** `true` si la definición declara algún objeto que el reveal pueda otorgar. */
export function isCoherentHiddenKeyDefinition(def: HiddenKeyDefinition): boolean {
  return hiddenKeyGrantedItem(def) !== null;
}
