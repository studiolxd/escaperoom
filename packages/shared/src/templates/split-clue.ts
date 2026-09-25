import type { PuzzleState, Rect, SplitClueDefinition } from "../schemas";
import { MAX_SPLIT_CLUE_VIEWPOINTS_FOR_SUBSET } from "../schemas/limits";
import { constantTimeEqual, guardPlayable, initialPuzzleState, publicBase } from "./base";

/**
 * Plantilla `split_clue` (specs/06 §2.7). La información está repartida entre
 * jugadores: cada punto de vista (`viewpoint`, p. ej. una mirilla) ve solo los
 * fragmentos de la pista que su zona deja ver. Toda la lógica vive aquí, en
 * `shared`: el servidor decide qué fragmentos ve cada jugador y valida la
 * combinación; el cliente solo recibe una proyección pública por punto de vista
 * (`toSplitCluePublicView`) que **nunca** incluye fragmentos ajenos ni la
 * solución completa.
 *
 * La lógica es pura: `submitCombination` y `placeSplitClueBridge` no mutan `state`,
 * devuelven objetos nuevos, así que el host (Colyseus/React) decide cuándo y
 * cómo persistirlos y los tests corren sin infraestructura ni `setTimeout`.
 *
 * Modelo de visibilidad (`visibleByViewpoint`, spec §2.7): el array de un punto
 * de vista es una **máscara posicional** de longitud `fragments.length`; una
 * entrada no nula en el índice `i` significa "este punto de vista ve el
 * fragmento `i`". El ejemplo de la spec ("`mirilla-a` ve índices 0 y 2") se
 * escribe `["A", null, "C"]`. Las entradas no nulas deben coincidir con
 * `fragments[i]` (lo comprueba `isCoherentSplitClueDefinition`), de modo que la
 * vista pública jamás puede fabricar un fragmento falso.
 *
 * El espejo (`soloBridgeItemId`) es el objeto-puente del modo solitario: al
 * colocarlo, la vista del jugador solo pasa a ser la **unión** de todos los
 * puntos de vista y puede resolver la pista en solitario.
 *
 * La restricción *física* (no poder ver ambas mitades a la vez) vive en Phaser
 * (oclusión por zona/posición); este módulo solo modela la parte lógica y el
 * cálculo de visibilidad que el servidor usa para autorizar qué fragmentos
 * viajan a cada jugador (specs/11 §4.3: `split_fragments {[index]: symbol}`).
 */

/** Estado interno de un `split_clue` (nunca sale al cliente tal cual). */
export interface SplitClueState {
  /** `locked` si hay `requiresSolved` pendientes; `failed` solo si es definitivo. */
  state: PuzzleState;
  /** Combinaciones enviadas (incluye aciertos). */
  attempts: number;
  /** `true` si el objeto-puente (espejo) ya se colocó (modo solitario). */
  bridged: boolean;
  /** Autor de la colocación del espejo, si el host lo registra. */
  bridgedBy?: string;
  solvedAt?: number;
  solvedBy?: string;
}

/** Desenlace de un envío de la combinación. */
export type SplitClueSubmitOutcome =
  "correct" | "wrong" | "incomplete" | "unavailable" | "already_solved";

export interface SplitClueSubmitResult {
  outcome: SplitClueSubmitOutcome;
  /** Estado resultante (nuevo objeto; `state` de entrada no se muta). */
  state: SplitClueState;
  attempts: number;
}

/** Desenlace de colocar el espejo. */
export type SplitClueBridgeOutcome =
  "bridged" | "already_bridged" | "unavailable" | "already_solved";

export interface SplitClueBridgeResult {
  outcome: SplitClueBridgeOutcome;
  /** Estado resultante (nuevo objeto; `state` de entrada no se muta). */
  state: SplitClueState;
}

/**
 * Proyección que viaja al cliente para **un** punto de vista. Contiene solo los
 * fragmentos que ese punto de vista tiene autorizado ver (o la unión si el
 * espejo ya está colocado); **no** incluye `fragments` completos,
 * `soloBridgeItemId`, `grantsItems` ni `unlocks`.
 */
export interface SplitCluePublicView {
  id: string;
  type: "split_clue";
  state: PuzzleState;
  inputUI: SplitClueDefinition["inputUI"];
  /** Punto de vista de este jugador (mirilla/objeto desde el que mira). */
  viewpointId: string;
  /** Número total de fragmentos de la pista (la longitud no es secreta). */
  fragmentsCount: number;
  /** Fragmento revelado por índice; `null` si está ocluido para este punto de vista. */
  visible: (string | null)[];
  /** Nº de posiciones que este punto de vista ve (con o sin espejo). */
  visibleCount: number;
  /** `true` si la definición admite el puente (sin revelar su id). */
  bridgeAvailable: boolean;
  /** `true` si el espejo está colocado y `visible` incluye la unión completa. */
  bridged: boolean;
  attempts: number;
  solvedAt: number | null;
  solvedBy: string | null;
}

/** Un puzzle con `requiresSolved` pendiente arranca `locked`; si no, `available`. */
export function createSplitClueState(def: SplitClueDefinition): SplitClueState {
  return {
    state: initialPuzzleState(def.requiresSolved),
    attempts: 0,
    bridged: false,
  };
}

/** `true` si la máscara revela el fragmento `index` para el punto de vista dado. */
export function canViewpointSee(
  def: SplitClueDefinition,
  viewpointId: string,
  index: number,
): boolean {
  return def.visibleByViewpoint[viewpointId]?.[index] != null;
}

/**
 * Máscara de visibilidad de un punto de vista **sin** espejo: los fragmentos
 * reales en las posiciones que puede ver y `null` en las ocluidas. Un punto de
 * vista desconocido no ve nada (nunca filtra por accidente).
 */
export function viewpointVisibility(
  def: SplitClueDefinition,
  viewpointId: string,
): (string | null)[] {
  const mask = def.visibleByViewpoint[viewpointId];
  return def.fragments.map((fragment, index) => (mask?.[index] != null ? fragment : null));
}

/**
 * Unión de todos los puntos de vista: posición revelada si **algún** viewpoint
 * la ve. Es lo que "ve" un jugador solitario con el espejo.
 */
export function unionVisibility(def: SplitClueDefinition): (string | null)[] {
  return def.fragments.map((fragment, index) =>
    def.viewpoints.some((viewpoint) => canViewpointSee(def, viewpoint.objectId, index))
      ? fragment
      : null,
  );
}

/** Visibilidad efectiva: con espejo, la unión; sin él, la del punto de vista. */
export function effectiveVisibility(
  def: SplitClueDefinition,
  viewpointId: string,
  bridged: boolean,
): (string | null)[] {
  return bridged ? unionVisibility(def) : viewpointVisibility(def, viewpointId);
}

/**
 * Formato de cable de specs/11 §4.3 (`split_fragments`): mapa `{ [index]: fragmento }`
 * solo con las posiciones visibles. Útil para que el host no serialice `null`s.
 */
export function visibleFragmentsByIndex(
  def: SplitClueDefinition,
  viewpointId: string,
  bridged = false,
): Record<number, string> {
  const result: Record<number, string> = {};
  effectiveVisibility(def, viewpointId, bridged).forEach((fragment, index) => {
    if (fragment !== null) result[index] = fragment;
  });
  return result;
}

/**
 * Punto de vista cuya zona contiene `(x, y)`, o `null`. La zona es un
 * rectángulo de origen arriba-izquierda (`x`, `y`) con ancho/alto (`w`, `h`),
 * en las mismas celdas del mundo que `wallOccluder`. El host lo usa para saber
 * qué mirilla está "ocupando" un jugador según su posición.
 */
export function viewpointAt(def: SplitClueDefinition, x: number, y: number): string | null {
  for (const viewpoint of def.viewpoints) {
    if (rectContains(viewpoint.zone, x, y)) return viewpoint.objectId;
  }
  return null;
}

/**
 * Punto de vista "más cercano" si `(x, y)` cae dentro de una zona, o el primero
 * declarado como respaldo; `null` si no hay viewpoints. Pensado para hosts que
 * quieren una respuesta estable cuando el avatar aún no está dentro de la zona.
 */
export function resolveViewpointForPosition(
  def: SplitClueDefinition,
  x: number,
  y: number,
): string | null {
  return viewpointAt(def, x, y) ?? def.viewpoints[0]?.objectId ?? null;
}

/**
 * Envía la combinación propuesta. Acepta un `string` en modo `code` (p. ej.
 * `"4538"`) o un array de fragmentos en modo `symbols`. No muta `state`.
 *
 * Solo cuenta como intento si la forma es evaluable (`correct`/`wrong`); una
 * entrada incompleta (`incomplete`) no incrementa `attempts`.
 */
export function submitCombination(
  state: SplitClueState,
  def: SplitClueDefinition,
  input: string | string[],
  now: number,
  playerId?: string,
): SplitClueSubmitResult {
  const guard = guardPlayable(state.state);
  if (guard !== null) return { outcome: guard, state, attempts: state.attempts };

  const evaluated = evaluateCombination(def, input);
  if (evaluated === "incomplete") {
    return { outcome: "incomplete", state, attempts: state.attempts };
  }

  const attempts = state.attempts + 1;
  if (evaluated === "correct") {
    const next: SplitClueState = {
      ...state,
      state: "solved",
      attempts,
      solvedAt: now,
      ...(playerId !== undefined ? { solvedBy: playerId } : {}),
    };
    return { outcome: "correct", state: next, attempts };
  }

  const next: SplitClueState = {
    ...state,
    state: state.state === "available" ? "in_progress" : state.state,
    attempts,
  };
  return { outcome: "wrong", state: next, attempts };
}

/**
 * Coloca el objeto-puente (el espejo) para el modo solitario. Idempotente: si ya
 * estaba colocado no muta el estado. `unavailable` si la definición no declara
 * `soloBridgeItemId` o el puzzle no admite interacción.
 */
export function placeSplitClueBridge(
  state: SplitClueState,
  def: SplitClueDefinition,
  playerId?: string,
): SplitClueBridgeResult {
  const guard = guardPlayable(state.state);
  if (guard !== null) return { outcome: guard, state };
  if (!def.soloBridgeItemId) return { outcome: "unavailable", state };
  if (state.bridged) return { outcome: "already_bridged", state };
  const next: SplitClueState = {
    ...state,
    bridged: true,
    ...(playerId !== undefined ? { bridgedBy: playerId } : {}),
  };
  return { outcome: "bridged", state: next };
}

/**
 * Proyección pública para un punto de vista concreto. Es la única forma en que
 * el cliente puede conocer fragmentos y, por diseño, nunca expone posiciones
 * que ese punto de vista no deba ver (salvo que el espejo esté colocado, que
 * revela la unión como puente de solitario).
 */
export function toSplitCluePublicView(
  state: SplitClueState,
  def: SplitClueDefinition,
  viewpointId: string,
): SplitCluePublicView {
  const visible = effectiveVisibility(def, viewpointId, state.bridged);
  return {
    ...publicBase(def.id, "split_clue", state.state, state.solvedAt, state.solvedBy),
    inputUI: def.inputUI,
    viewpointId,
    fragmentsCount: def.fragments.length,
    visible,
    visibleCount: visible.filter((fragment) => fragment !== null).length,
    bridgeAvailable: def.soloBridgeItemId !== undefined,
    bridged: state.bridged,
    attempts: state.attempts,
  };
}

/**
 * Comprobación para el validador futuro: la definición es coherente y la unión
 * de puntos de vista cubre la pista entera. Un estado ya resuelto siempre es
 * resoluble; `failed` definitivo no.
 */
export function isSplitClueSolvable(state: SplitClueState, def: SplitClueDefinition): boolean {
  if (state.state === "solved") return true;
  if (state.state === "failed") return false;
  if (!isCoherentSplitClueDefinition(def)) return false;
  return unionCoversAll(def);
}

/**
 * `true` si un grupo de `playerCount` jugadores puede cubrir la pista: con un
 * solo jugador exige el objeto-puente; con varios, existe una asignación de
 * jugadores a puntos de vista (≥1 jugador por mirilla) cuya unión cubre la
 * pista (specs/22 §2.1).
 */
export function isSplitClueSolvableForGroup(
  def: SplitClueDefinition,
  playerCount: number,
): boolean {
  if (!isCoherentSplitClueDefinition(def)) return false;
  if (playerCount <= 1) return def.soloBridgeItemId !== undefined && unionCoversAll(def);
  if (playerCount >= def.viewpoints.length) return unionCoversAll(def);
  return existsCoveringSubset(def, playerCount);
}

/**
 * `true` si `def.fragments` es una pista válida y `visibleByViewpoint` la
 * describe sin contradicciones: cada punto de vista declarado tiene su máscara,
 * de la longitud correcta, y las entradas no nulas coinciden con el fragmento
 * real de esa posición.
 */
export function isCoherentSplitClueDefinition(def: SplitClueDefinition): boolean {
  if (def.fragments.length === 0) return false;
  if (def.fragments.some((fragment) => fragment.trim().length === 0)) return false;
  if (def.viewpoints.length === 0) return false;

  const viewpointIds = new Set<string>();
  for (const viewpoint of def.viewpoints) {
    if (viewpoint.objectId.trim().length === 0 || viewpointIds.has(viewpoint.objectId)) {
      return false;
    }
    viewpointIds.add(viewpoint.objectId);

    const mask = def.visibleByViewpoint[viewpoint.objectId];
    if (!mask || mask.length !== def.fragments.length) return false;
    for (let index = 0; index < mask.length; index++) {
      const value = mask[index];
      if (value !== null && value !== def.fragments[index]) return false;
    }
  }

  for (const key of Object.keys(def.visibleByViewpoint)) {
    if (!viewpointIds.has(key)) return false;
  }

  if (def.soloBridgeItemId !== undefined && def.soloBridgeItemId.trim().length === 0) {
    return false;
  }
  return true;
}

/** `true` si algún punto de vista revela cada una de las posiciones de la pista. */
export function unionCoversAll(def: SplitClueDefinition): boolean {
  return def.fragments.every((_, index) =>
    def.viewpoints.some((viewpoint) => canViewpointSee(def, viewpoint.objectId, index)),
  );
}

/**
 * ¿Hay `maxViewpoints` puntos de vista o menos cuya unión cubre toda la pista?
 * Búsqueda exhaustiva por bitmask (los puntos de vista de una pista son pocos;
 * por encima de `MAX_SPLIT_CLUE_VIEWPOINTS_FOR_SUBSET` se degrada a comprobar
 * la unión completa). El validador llama a esto por cada candidato de cada
 * nodo del BFS (hasta 200k estados, `oracles.ts`), así que el tope se guarda
 * bajo (auditoría D-9): con 20 puntos de vista, 2²⁰ ≈ 1M iteraciones por
 * llamada ya multiplican la explosión de estados del BFS.
 */
function existsCoveringSubset(def: SplitClueDefinition, maxViewpoints: number): boolean {
  const count = def.viewpoints.length;
  if (count > MAX_SPLIT_CLUE_VIEWPOINTS_FOR_SUBSET || def.fragments.length > 20) {
    return unionCoversAll(def);
  }
  const full = (1 << def.fragments.length) - 1;
  for (let mask = 1; mask < 1 << count; mask++) {
    if (popcount(mask) > maxViewpoints) continue;
    let covered = 0;
    for (let v = 0; v < count; v++) {
      if (!(mask & (1 << v))) continue;
      const viewpointId = def.viewpoints[v]!.objectId;
      for (let index = 0; index < def.fragments.length; index++) {
        if (canViewpointSee(def, viewpointId, index)) covered |= 1 << index;
      }
    }
    if (covered === full) return true;
  }
  return false;
}

function popcount(value: number): number {
  let count = 0;
  let bits = value;
  while (bits > 0) {
    bits &= bits - 1;
    count++;
  }
  return count;
}

/** Compara la entrada con la pista: `correct`, `wrong` o `incomplete` (no evaluable). */
function evaluateCombination(
  def: SplitClueDefinition,
  input: string | string[],
): "correct" | "wrong" | "incomplete" {
  if (def.inputUI === "code") {
    if (typeof input !== "string") return "incomplete";
    const candidate = input.trim();
    const solution = def.fragments.join("");
    if (candidate.length === 0 || candidate.length < solution.length) return "incomplete";
    return constantTimeEqual(candidate, solution) ? "correct" : "wrong";
  }

  if (!Array.isArray(input)) return "incomplete";
  const submitted = input.map((fragment) => String(fragment).trim());
  if (submitted.length < def.fragments.length) return "incomplete";
  if (submitted.length > def.fragments.length) return "wrong";
  return submitted.every((fragment, index) => constantTimeEqual(fragment, def.fragments[index] ?? ""))
    ? "correct"
    : "wrong";
}

/** `true` si `(x, y)` cae dentro del rectángulo (origen arriba-izquierda, max exclusivo). */
function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}
