import {
  toPublicRuntimeModel,
  toRuntimeModel,
  type PublicRuntimeModel,
} from "@escaperoom/game-runtime";
import type { RoomScenePack } from "@escaperoom/game-runtime/phaser";
import { withLobbyRoom, type RoomPackage } from "@escaperoom/shared/schemas";
import { resolvePack3DBaseUrl, resolveRoomPreviewPack } from "./room-preview-pack";

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
  /** Pack 2D. En una sala 3D se sigue devolviendo si existe: el HUD lo usa para iconos y retratos. */
  pack?: RoomScenePack;
  /** Pack 3D (modelos GLB); solo en salas 3D. Sin `baseUrl`, el runtime pinta cajas. */
  pack3d?: Pack3D;
}

export interface Pack3D {
  baseUrl?: string;
  packId: string;
  /** URLs firmadas de los modelos propios, por `ref` (`customModels[id].ref`). Sin URL, caja. */
  customModelUrls?: Record<string, string>;
}

/** `pack3d` de una sala: solo existe si el modelo es 3D. */
export function buildPack3D(model: { dimension: string }, tileset: string): Pack3D | undefined {
  if (model.dimension !== "3d") return undefined;
  const baseUrl = resolvePack3DBaseUrl(tileset);
  return baseUrl ? { baseUrl, packId: tileset } : { packId: tileset };
}

export function buildGameModel(roomPackage: RoomPackage, locale: string): GameModelPayload {
  // Encargo lobby-diseño: el modelo incluye la sala de espera que juega la
  // `GameRoom` (la diseñada o la generada con `withLobbyRoom`, mismo id).
  const fullModel = toRuntimeModel(withLobbyRoom(roomPackage), { locale });
  const { pack } = resolveRoomPreviewPack(roomPackage.map.tileset, fullModel);
  const model = toPublicRuntimeModel(fullModel);
  const pack3d = buildPack3D(fullModel, roomPackage.map.tileset);
  return {
    model,
    ...(pack ? { pack } : {}),
    ...(pack3d ? { pack3d } : {}),
  };
}
