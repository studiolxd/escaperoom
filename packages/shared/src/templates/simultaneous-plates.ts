import type { SimultaneousPlatesDefinition, PuzzleState } from "../schemas";

/**
 * Plantilla `simultaneous_plates` (specs/06 §2.3). Toda la validación de la
 * ventana temporal vive aquí, en `shared`: el servidor recibe cada
 * `plate_activated`/`plate_deactivated` con un **tiempo lógico** inyectado y
 * comprueba que todas las placas están activas dentro de `windowMs`. El cliente
 * solo recibe una proyección pública (`toSimultaneousPlatesPublicView`) que
 * **nunca** revela el objeto-puente (`soloBridgeItemId`) ni la solución.
 *
 * La lógica es pura: `setPlateActive` y `placeSoloBridge` no mutan `state`,
 * devuelven objetos nuevos, así que el host (Colyseus/React) decide cuándo y
 * cómo persistirlos y los tests corren sin infraestructura ni `setTimeout`.
 *
 * Modos de `holdMode` (specs/06 §2.3):
 * - `press`: cada pulsación es un pulso válido durante `windowMs`; todas las
 *   placas deben haberse pulsado dentro de la misma ventana.
 * - `stand`: la placa queda activa mientras el avatar se mantiene encima; la
 *   resolución exige que todas estén activas a la vez.
 *
 * El objeto-puente (`soloBridgeItemId`) fija una placa de forma permanente al
 * colocarlo, sustituyendo a un jugador en solitario sin código especial.
 */

/** Estado interno de una placa (nunca sale al cliente tal cual). */
export interface PlateRuntime {
  objectId: string;
  /** Activa (pulsada o sostenida); el puente la mantiene activa siempre. */
  active: boolean;
  /** Tiempo lógico de la última activación, o `null` si está inactiva. */
  activatedAt: number | null;
  /** `true` si el objeto-puente la fija de forma permanente (modo solitario). */
  bridged: boolean;
  /** Autor de la activación, si el host lo registra. */
  activatedBy?: string;
}

/** Estado interno de un `simultaneous_plates` (nunca sale al cliente tal cual). */
export interface SimultaneousPlatesState {
  /** `locked` si hay `requiresSolved` pendientes; `failed` solo si es definitivo. */
  state: PuzzleState;
  /** Estado por placa, indexado por `objectId`. */
  plates: Record<string, PlateRuntime>;
  solvedAt?: number;
  solvedBy?: string;
  /** Tiempo lógico en el que se cerró la última ventana sin resolverse. */
  expiredAt?: number;
}

/** Desenlace de una activación/desactivación (o de colocar el puente). */
export type PlateOutcome =
  | "activated"
  | "deactivated"
  | "solved"
  | "expired"
  | "already_active"
  | "already_inactive"
  | "already_solved"
  | "unavailable"
  | "unknown_plate";

export interface PlateActionResult {
  outcome: PlateOutcome;
  /** Estado resultante (nuevo objeto; `state` de entrada no se muta). */
  state: SimultaneousPlatesState;
  /** Placa implicada; `null` si el id era desconocido y no se pudo resolver. */
  plateObjectId: string | null;
  /** Ids de las placas efectivamente activas tras aplicar la acción. */
  activePlateIds: string[];
}

/** Proyección de una placa que viaja al cliente (sin `soloBridgeItemId`). */
export interface SimultaneousPlatesPlateView {
  objectId: string;
  active: boolean;
  bridged: boolean;
  activatedAt: number | null;
}

/**
 * Proyección que viaja al cliente: lo justo para que el panel pinte el
 * progreso, la cuenta atrás de la ventana y el estado por placa. **No** incluye
 * `soloBridgeItemId`, `grantsItems` ni `unlocks`.
 */
export interface SimultaneousPlatesPublicView {
  id: string;
  type: "simultaneous_plates";
  state: PuzzleState;
  holdMode: SimultaneousPlatesDefinition["holdMode"];
  windowMs: number;
  plates: SimultaneousPlatesPlateView[];
  activeCount: number;
  totalCount: number;
  /** Fin de la ventana activa en tiempo lógico, o `null` si no hay ninguna. */
  windowEndsAt: number | null;
  solvedAt: number | null;
  solvedBy: string | null;
}

/** Un puzzle con `requiresSolved` pendiente arranca `locked`; si no, `available`. */
export function createSimultaneousPlatesState(
  def: SimultaneousPlatesDefinition,
): SimultaneousPlatesState {
  const plates: Record<string, PlateRuntime> = {};
  for (const plate of def.plates) {
    plates[plate.objectId] = {
      objectId: plate.objectId,
      active: false,
      activatedAt: null,
      bridged: false,
    };
  }
  return { state: def.requiresSolved.length > 0 ? "locked" : "available", plates };
}

/**
 * `true` si la placa cuenta como activa en `now`. El puente siempre activa; en
 * `stand` basta con estar sostenida; en `press` la pulsación caduca a los
 * `windowMs`.
 */
export function isPlateActive(
  plate: PlateRuntime | undefined,
  def: SimultaneousPlatesDefinition,
  now: number,
): boolean {
  if (!plate) return false;
  if (plate.bridged) return true;
  if (!plate.active) return false;
  if (def.holdMode === "stand") return true;
  return plate.activatedAt !== null && now - plate.activatedAt <= def.windowMs;
}

/** Ids de las placas activas en `now`, en el orden de la definición. */
export function activePlateIds(
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
  now: number,
): string[] {
  return def.plates
    .filter((plate) => isPlateActive(state.plates[plate.objectId], def, now))
    .map((plate) => plate.objectId);
}

/** `true` si todas las placas están activas a la vez en `now`. */
export function allPlatesActive(
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
  now: number,
): boolean {
  if (def.plates.length === 0) return false;
  return def.plates.every((plate) => isPlateActive(state.plates[plate.objectId], def, now));
}

/**
 * Activa o desactiva una placa. En `press`, antes de evaluar, caduca cualquier
 * pulsación anterior a `now - windowMs` (su ventana ya se cerró). Devuelve el
 * estado nuevo y el desenlace; es idempotente (repetir una activación ya
 * vigente no muta el estado y un puzzle resuelto no vuelve a validar).
 */
export function setPlateActive(
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
  objectId: string,
  active: boolean,
  now: number,
  playerId?: string,
): PlateActionResult {
  if (state.state === "solved") return plateResult("already_solved", state, def, objectId, now);
  if (state.state === "locked" || state.state === "failed") {
    return plateResult("unavailable", state, def, objectId, now);
  }
  if (!def.plates.some((plate) => plate.objectId === objectId)) {
    return plateResult("unknown_plate", state, def, objectId, now);
  }

  const refreshed = expireStalePlates(state, def, now);
  const plate = refreshed.plates[objectId];
  if (!plate) return plateResult("unknown_plate", refreshed, def, objectId, now);

  if (!active) {
    if (!plate.active || plate.bridged) {
      return plateResult("already_inactive", refreshed, def, objectId, now);
    }
    const plates = {
      ...refreshed.plates,
      [objectId]: { ...plate, active: false, activatedAt: null, activatedBy: undefined },
    };
    return plateResult("deactivated", { ...refreshed, plates }, def, objectId, now);
  }

  if (plate.active || plate.bridged) {
    return plateResult("already_active", refreshed, def, objectId, now);
  }

  const plates = {
    ...refreshed.plates,
    [objectId]: {
      ...plate,
      active: true,
      activatedAt: now,
      ...(playerId !== undefined ? { activatedBy: playerId } : {}),
    },
  };
  return settle({ ...refreshed, plates }, def, objectId, now, refreshed !== state);
}

/**
 * Coloca el objeto-puente (`soloBridgeItemId`) sobre una placa, fijándola de
 * forma permanente. Sin `plateObjectId` se elige la primera placa libre. Es
 * idempotente: si la placa ya está fijada, no vuelve a mutar el estado.
 */
export function placeSoloBridge(
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
  now: number,
  plateObjectId?: string,
  playerId?: string,
): PlateActionResult {
  if (state.state === "solved") {
    return plateResult("already_solved", state, def, plateObjectId ?? null, now);
  }
  if (state.state === "locked" || state.state === "failed") {
    return plateResult("unavailable", state, def, plateObjectId ?? null, now);
  }
  if (!def.soloBridgeItemId) {
    return plateResult("unavailable", state, def, plateObjectId ?? null, now);
  }

  const target =
    plateObjectId ??
    def.plates.find((plate) => !state.plates[plate.objectId]?.bridged)?.objectId ??
    null;
  if (target === null || !def.plates.some((plate) => plate.objectId === target)) {
    return plateResult("unknown_plate", state, def, target, now);
  }

  const plate = state.plates[target];
  if (!plate) return plateResult("unknown_plate", state, def, target, now);
  if (plate.bridged) return plateResult("already_active", state, def, target, now);

  const plates = {
    ...state.plates,
    [target]: {
      ...plate,
      bridged: true,
      active: true,
      activatedAt: now,
      ...(playerId !== undefined ? { activatedBy: playerId } : {}),
    },
  };
  return settle({ ...state, plates }, def, target, now, false);
}

/**
 * Proyección pública: estado por placa, progreso y fin de ventana, sin
 * `soloBridgeItemId` ni la solución. Se prefija con `SimultaneousPlates` para
 * no colisionar con `toPublicView` de `code-lock` al reexportar las plantillas.
 */
export function toSimultaneousPlatesPublicView(
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
  now = 0,
): SimultaneousPlatesPublicView {
  const active = activePlateIds(state, def, now);
  const activeSet = new Set(active);
  return {
    id: def.id,
    type: "simultaneous_plates",
    state: state.state,
    holdMode: def.holdMode,
    windowMs: def.windowMs,
    plates: def.plates.map((plate) => {
      const runtime = state.plates[plate.objectId];
      return {
        objectId: plate.objectId,
        active: activeSet.has(plate.objectId),
        bridged: runtime?.bridged ?? false,
        activatedAt: runtime?.activatedAt ?? null,
      };
    }),
    activeCount: active.length,
    totalCount: def.plates.length,
    windowEndsAt: windowEndsAt(state, def, now),
    solvedAt: state.solvedAt ?? null,
    solvedBy: state.solvedBy ?? null,
  };
}

/**
 * Fin de la ventana abierta por la primera pulsación activa (solo `press`), o
 * `null` si no hay ninguna. El panel lo usa para pintar la cuenta atrás.
 */
export function windowEndsAt(
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
  now: number,
): number | null {
  if (def.holdMode !== "press") return null;
  let earliest: number | null = null;
  for (const plate of def.plates) {
    const runtime = state.plates[plate.objectId];
    if (!runtime || runtime.bridged || !runtime.active || runtime.activatedAt === null) continue;
    if (now - runtime.activatedAt > def.windowMs) continue;
    if (earliest === null || runtime.activatedAt < earliest) earliest = runtime.activatedAt;
  }
  return earliest === null ? null : earliest + def.windowMs;
}

/**
 * Comprobación simple para el validador futuro: hay placas únicas con id y la
 * definición es coherente; un estado ya resuelto siempre es resoluble.
 */
export function isSimultaneousPlatesSolvable(
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
): boolean {
  if (state.state === "solved") return true;
  if (state.state === "failed") return false;
  return isCoherentSimultaneousPlatesDefinition(def);
}

/** `true` si la definición declara placas únicas con id y un `windowMs` válido. */
export function isCoherentSimultaneousPlatesDefinition(
  def: SimultaneousPlatesDefinition,
): boolean {
  if (def.plates.length === 0 || def.windowMs <= 0) return false;
  const ids = new Set<string>();
  for (const plate of def.plates) {
    if (plate.objectId.trim().length === 0 || ids.has(plate.objectId)) return false;
    ids.add(plate.objectId);
  }
  if (def.soloBridgeItemId !== undefined && def.soloBridgeItemId.trim().length === 0) {
    return false;
  }
  return true;
}

/** Caduca las pulsaciones (`press`) cuya ventana ya se cerró en `now`. */
function expireStalePlates(
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
  now: number,
): SimultaneousPlatesState {
  if (def.holdMode === "stand") return state;
  let expired = false;
  const plates = { ...state.plates };
  for (const plateDef of def.plates) {
    const plate = plates[plateDef.objectId];
    if (!plate || plate.bridged || !plate.active || plate.activatedAt === null) continue;
    if (now - plate.activatedAt > def.windowMs) {
      plates[plateDef.objectId] = {
        ...plate,
        active: false,
        activatedAt: null,
        activatedBy: undefined,
      };
      expired = true;
    }
  }
  return expired ? { ...state, plates, expiredAt: now } : state;
}

/** Resuelve si todas las placas están activas; si no, marca `in_progress`. */
function settle(
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
  objectId: string,
  now: number,
  windowExpired: boolean,
): PlateActionResult {
  if (allPlatesActive(state, def, now)) {
    return plateResult("solved", { ...state, state: "solved", solvedAt: now }, def, objectId, now);
  }
  const next = state.state === "available" ? { ...state, state: "in_progress" as PuzzleState } : state;
  return plateResult(windowExpired ? "expired" : "activated", next, def, objectId, now);
}

function plateResult(
  outcome: PlateOutcome,
  state: SimultaneousPlatesState,
  def: SimultaneousPlatesDefinition,
  objectId: string | null,
  now: number,
): PlateActionResult {
  return {
    outcome,
    state,
    plateObjectId: objectId,
    activePlateIds: activePlateIds(state, def, now),
  };
}
