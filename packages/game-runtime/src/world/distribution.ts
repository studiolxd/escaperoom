import type { RuntimeModel, RuntimeObject } from "../loader";
import type { DistributionMode } from "./types";

/**
 * Inventario interno de los objetos (specs/04 §3.2): cajones, arcas y cofres
 * declaran `inventory` y, al abrirse, su contenido se reparte según
 * `distribution` (`first_click`, `all_players`, `assigned`). Lógica pura,
 * determinista e inmutable: cada operación devuelve un mapa nuevo.
 *
 * El motor de reglas de 1.4 consume este módulo para las acciones
 * `grant_item`/`consume_item`; aquí no se conoce ni se muta dicho motor.
 */

export interface ContainerState {
  /** Items que siguen dentro del contenedor. */
  contents: string[];
  /** ¿Se abrió y repartió ya su contenido? */
  opened: boolean;
}

export type ContainerStateMap = Record<string, ContainerState>;

/** Crea el estado de todos los contenedores declarados por el modelo. */
export function createContainerStateMap(model: RuntimeModel): ContainerStateMap {
  const map: ContainerStateMap = {};
  for (const object of model.objects) {
    if (object.inventory && object.inventory.length > 0) {
      map[object.id] = { contents: [...object.inventory], opened: false };
    }
  }
  return map;
}

/** Estado interno de un objeto, si es contenedor. */
export function containerOf(map: ContainerStateMap, objectId: string): ContainerState | undefined {
  return map[objectId];
}

/** Copia del contenido pendiente (nunca la referencia interna). */
export function containerContents(map: ContainerStateMap, objectId: string): string[] {
  return [...(map[objectId]?.contents ?? [])];
}

/** ¿El contenedor guarda al menos una unidad de `itemId`? */
export function containsItem(map: ContainerStateMap, objectId: string, itemId: string): boolean {
  return map[objectId]?.contents.includes(itemId) ?? false;
}

export interface CollectOptions {
  /** Jugador que abre/interactúa. */
  openerId: string;
  /** Jugadores presentes (para `all_players`). */
  playerIds?: string[];
  /** Asignación explícita para `assigned`: `playerId → itemIds`. */
  assigned?: Record<string, string[]>;
}

export interface CollectResult {
  map: ContainerStateMap;
  /** Items entregados a cada jugador. */
  grants: Record<string, string[]>;
  /** `true` si el contenedor quedó abierto tras esta operación. */
  opened: boolean;
  /** `true` si ya estaba abierto y no se repartió nada. */
  alreadyOpen: boolean;
}

/**
 * Abre el contenedor y reparte su contenido según su `distribution`:
 *
 * - `first_click` (por defecto): solo quien abre recibe todo.
 * - `all_players`: todos los jugadores presentes reciben todo.
 * - `assigned`: cada jugador recibe los items asignados; el resto queda dentro.
 *
 * Es idempotente: si el contenedor ya estaba abierto no vuelve a repartir.
 */
export function collectContainer(
  map: ContainerStateMap,
  object: RuntimeObject,
  options: CollectOptions,
): CollectResult {
  const state = map[object.id];
  if (!state || (object.inventory?.length ?? 0) === 0) {
    return { map, grants: {}, opened: false, alreadyOpen: false };
  }
  if (state.opened) {
    return { map, grants: {}, opened: true, alreadyOpen: true };
  }

  const mode: DistributionMode = object.distribution ?? "first_click";
  const grants: Record<string, string[]> = {};
  let remaining: string[];

  if (mode === "assigned") {
    remaining = [...state.contents];
    for (const [playerId, itemIds] of Object.entries(options.assigned ?? {})) {
      const granted: string[] = [];
      for (const itemId of itemIds) {
        const index = remaining.indexOf(itemId);
        if (index >= 0) {
          remaining.splice(index, 1);
          granted.push(itemId);
        }
      }
      if (granted.length > 0) {
        grants[playerId] = granted;
      }
    }
  } else {
    const recipients =
      mode === "all_players" ? (options.playerIds ?? [options.openerId]) : [options.openerId];
    for (const playerId of recipients) {
      grants[playerId] = [...state.contents];
    }
    remaining = [];
  }

  return {
    map: { ...map, [object.id]: { contents: remaining, opened: true } },
    grants,
    opened: true,
    alreadyOpen: false,
  };
}

export interface ConsumeResult {
  map: ContainerStateMap;
  /** `true` si se encontró y retiró el item. */
  consumed: boolean;
}

/** Retira una unidad de `itemId` del contenedor (acción `consume_item`). */
export function consumeFromContainer(
  map: ContainerStateMap,
  objectId: string,
  itemId: string,
): ConsumeResult {
  const state = map[objectId];
  if (!state) {
    return { map, consumed: false };
  }
  const index = state.contents.indexOf(itemId);
  if (index < 0) {
    return { map, consumed: false };
  }
  const contents = [...state.contents];
  contents.splice(index, 1);
  return { map: { ...map, [objectId]: { ...state, contents } }, consumed: true };
}
