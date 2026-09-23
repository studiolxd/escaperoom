import type { RuntimeModel, RuntimeObject } from "../loader";
import { currentObjectState, initialObjectState } from "./state";
import type { ObjectStateMap } from "./types";

/**
 * Mundo reactivo a puzzles (specs/04 §3.4, notas de diseño del Rey Aldric §7):
 * qué antorchas arden y por dónde corre el agua según el estado **actual** de
 * los objetos. Es una feature del runtime, no del formato: se deriva de datos
 * que el `RoomPackage` ya trae, sin campos nuevos.
 *
 * - Antorcha con `objectId`: arde cuando ese objeto ha salido de su estado
 *   inicial (el brasero pasa de `unlit` a `lit`).
 * - Antorcha **sin** `objectId` en una habitación con un objeto que declara el
 *   estado `active` (la `mesa-catas` de la Bodega): arde cuando ese objeto está
 *   `active` — las antorchas de la escalera se encienden al resolver las copas.
 * - Resto de antorchas: siempre encendidas.
 *
 * El canal de agua es el de cada puzzle `pipes` de la habitación: nace en el
 * objeto que el puzzle bloquea (`lockedBy`, p. ej. `canal-entrada`) y llega a
 * los objetos que desbloquea (`unlocks`, p. ej. `altar`); fluye cuando el
 * destino sale de su estado inicial (`dry → flowing`, regla `r-canal-resuelto`).
 * Todo es puro: la escena Phaser solo pinta el resultado.
 */

/** Estado del objeto que enciende las antorchas "sueltas" de una habitación. */
export const REACTIVE_LIGHT_STATE = "active";

export interface TorchLightState {
  x: number;
  y: number;
  /** ¿Arde? Si no, la escena la pinta apagada. */
  lit: boolean;
  /** Objeto del que depende la antorcha, si depende de alguno. */
  drivenBy?: string;
}

export interface WaterChannel {
  /** Puzzle `pipes` al que pertenece el canal. */
  puzzleId: string;
  /** Objeto de origen (entrada del canal). */
  fromObjectId: string;
  /** Objeto de destino (altar). */
  toObjectId: string;
  /** Celdas del canal, del origen al destino (recorrido en L: primero en `x`). */
  cells: { x: number; y: number }[];
  /** ¿Corre el agua? */
  flowing: boolean;
}

function hasLeftInitialState(object: RuntimeObject, states: ObjectStateMap): boolean {
  return currentObjectState(states, object) !== initialObjectState(object);
}

/** Objeto de la habitación que gobierna sus antorchas sin `objectId`, si lo hay. */
export function reactiveLightSource(
  model: RuntimeModel,
  roomId: string,
): RuntimeObject | undefined {
  return model.subroomsById[roomId]?.objects.find((object) =>
    object.states.includes(REACTIVE_LIGHT_STATE),
  );
}

/** Estado de cada antorcha de la habitación con el estado actual del mundo. */
export function resolveTorchLights(
  model: RuntimeModel,
  roomId: string,
  states: ObjectStateMap,
): TorchLightState[] {
  const room = model.subroomsById[roomId];
  if (!room) return [];
  const source = reactiveLightSource(model, roomId);
  const torches: TorchLightState[] = [];
  for (const light of room.lighting) {
    if (light.type !== "torch") continue;
    const bound = light.objectId ? model.objectsById[light.objectId] : undefined;
    if (bound) {
      torches.push({
        x: light.x,
        y: light.y,
        lit: hasLeftInitialState(bound, states),
        drivenBy: bound.id,
      });
    } else if (source) {
      torches.push({
        x: light.x,
        y: light.y,
        lit: currentObjectState(states, source) === REACTIVE_LIGHT_STATE,
        drivenBy: source.id,
      });
    } else {
      torches.push({ x: light.x, y: light.y, lit: true });
    }
  }
  return torches;
}

/** Ids de los objetos cuyo cambio de estado altera la iluminación o el agua. */
export function reactiveObjectIds(model: RuntimeModel, roomId: string): Set<string> {
  const ids = new Set<string>();
  for (const torch of resolveTorchLights(model, roomId, {})) {
    if (torch.drivenBy) ids.add(torch.drivenBy);
  }
  for (const channel of resolveWaterChannels(model, roomId, {})) {
    ids.add(channel.toObjectId);
  }
  return ids;
}

/** Canales de agua de los puzzles `pipes` de la habitación. */
export function resolveWaterChannels(
  model: RuntimeModel,
  roomId: string,
  states: ObjectStateMap,
): WaterChannel[] {
  const room = model.subroomsById[roomId];
  if (!room) return [];
  const channels: WaterChannel[] = [];
  for (const puzzle of model.puzzles) {
    if (puzzle.type !== "pipes" || puzzle.roomId !== roomId) continue;
    const source = room.objects.find((object) => object.lockedBy === puzzle.id);
    if (!source) continue;
    for (const targetId of puzzle.unlocks) {
      const target = model.objectsById[targetId];
      if (!target || target.roomId !== roomId) continue;
      channels.push({
        puzzleId: puzzle.id,
        fromObjectId: source.id,
        toObjectId: target.id,
        cells: channelCells(source.position, target.position),
        flowing: hasLeftInitialState(target, states),
      });
    }
  }
  return channels;
}

/** Recorrido en L (primero horizontal, luego vertical) entre dos celdas, ambos extremos incluidos. */
function channelCells(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  let x = Math.round(from.x);
  let y = Math.round(from.y);
  cells.push({ x, y });
  while (x !== Math.round(to.x)) {
    x += stepX;
    cells.push({ x, y });
  }
  while (y !== Math.round(to.y)) {
    y += stepY;
    cells.push({ x, y });
  }
  return cells;
}
