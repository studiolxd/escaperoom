import { toRuntimeModel, type RuntimeModel } from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { resolveRoomPreviewPack } from "./room-preview-pack";

/**
 * Lo que la página de partida manda al navegador (fase 2): el **modelo del
 * runtime** —mapa, objetos, ítems, diálogos, geometría de placas/mirillas y
 * pistas sin texto— y el pack gráfico. Se calcula en el servidor: el
 * `RoomPackage` (con códigos y soluciones) nunca sale de aquí.
 */
export interface GameModelPayload {
  model: RuntimeModel;
  pack?: RoomScenePack;
}

export function buildGameModel(roomPackage: RoomPackage, locale: string): GameModelPayload {
  const model = toRuntimeModel(roomPackage, { locale });
  const { pack } = resolveRoomPreviewPack(roomPackage.map.tileset, model);
  return pack ? { model, pack } : { model };
}
