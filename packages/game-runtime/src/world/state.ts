import type { RuntimeModel, RuntimeObject } from "../loader";
import type { ObjectStateMap } from "./types";

/**
 * Máquina de estados de los `WorldObject` (specs/04 §3.1). Los estados son
 * strings arbitrarios definidos por el creador; el runtime solo sabe pintar el
 * estado actual y validar que una transición apunta a un estado declarado.
 * Todo es puro e inmutable: cada transición devuelve un mapa nuevo.
 */

export class WorldObjectStateError extends Error {
  readonly objectId: string;
  readonly state: string;

  constructor(objectId: string, state: string, message: string) {
    super(message);
    this.name = "WorldObjectStateError";
    this.objectId = objectId;
    this.state = state;
  }
}

/** ¿El objeto declara este estado? */
export function hasObjectState(object: RuntimeObject, state: string): boolean {
  return object.states.includes(state) || state in object.spriteByState;
}

/** Estado inicial efectivo: `initialState` si existe; si no, el primero declarado. */
export function initialObjectState(object: RuntimeObject): string {
  if (object.initialState && hasObjectState(object, object.initialState)) {
    return object.initialState;
  }
  return object.states[0] ?? object.initialState ?? "";
}

/** Crea el mapa de estados inicial de todos los objetos del modelo. */
export function createObjectStateMap(model: RuntimeModel): ObjectStateMap {
  const map: ObjectStateMap = {};
  for (const object of model.objects) {
    map[object.id] = initialObjectState(object);
  }
  return map;
}

/** Estado actual de un objeto (con fallback a su estado inicial). */
export function currentObjectState(map: ObjectStateMap, object: RuntimeObject): string {
  return map[object.id] ?? initialObjectState(object);
}

/**
 * Aplica una transición de estado. Es idempotente (mismo estado → mismo mapa) y
 * lanza `WorldObjectStateError` si el estado no está declarado por el objeto.
 */
export function setObjectState(
  map: ObjectStateMap,
  object: RuntimeObject,
  state: string,
): ObjectStateMap {
  if (!hasObjectState(object, state)) {
    throw new WorldObjectStateError(
      object.id,
      state,
      `Transición inválida: el objeto "${object.id}" no declara el estado "${state}". Estados: ${
        object.states.length > 0 ? object.states.join(", ") : "(ninguno)"
      }.`,
    );
  }
  if (map[object.id] === state) {
    return map;
  }
  return { ...map, [object.id]: state };
}

/** Sprite del estado pedido, con fallback al sprite base del objeto. */
export function resolveObjectStateSprite(object: RuntimeObject, state: string): string {
  return object.spriteByState[state] ?? object.sprite;
}

/** Animación de transición declarada para el estado, si existe. */
export function resolveObjectStateAnimation(
  object: RuntimeObject,
  state: string,
): string | undefined {
  return object.animationByState?.[state];
}
