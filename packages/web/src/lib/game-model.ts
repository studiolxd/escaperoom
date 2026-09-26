import {
  toPublicRuntimeModel,
  toRuntimeModel,
  type PublicRuntimeModel,
} from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import type { RoomPackage } from "@escaperoom/shared/schemas";
import { resolveRoomPreviewPack } from "./room-preview-pack";

/**
 * Lo que la página de partida manda al navegador (fase 2): el **modelo del
 * runtime** —mapa, objetos, ítems, diálogos, geometría de placas/mirillas y
 * pistas sin texto— y el pack gráfico. Se calcula en el servidor: el
 * `RoomPackage` (con códigos y soluciones) nunca sale de aquí.
 *
 * Siempre partida en red (`GameRoom`/`PlaytestRoom`/sesión de evento vía
 * Colyseus, auditoría D-26): el modelo es la proyección **pública**, sin
 * `inventory` ni `hidingSpot.contains` — ese contenido lo decide y entrega el
 * servidor. El modo local sin servidor (playtest, previsualizaciones) y el
 * editor calculan el `RuntimeModel` completo aparte, con `toRuntimeModel`.
 */
export interface GameModelPayload {
  model: PublicRuntimeModel;
  pack?: RoomScenePack;
}

export function buildGameModel(roomPackage: RoomPackage, locale: string): GameModelPayload {
  const fullModel = toRuntimeModel(roomPackage, { locale });
  const { pack } = resolveRoomPreviewPack(roomPackage.map.tileset, fullModel);
  const model = toPublicRuntimeModel(fullModel);
  return pack ? { model, pack } : { model };
}
