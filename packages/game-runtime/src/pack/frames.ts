import type { RuntimeModel } from "../loader";
import type { PackManifest } from "./manifest";

/**
 * Resolución de frames **por nombre** (specs/26 §3.3): el runtime nunca usa
 * tablas específicas de un pack. Si el manifiesto declara una equivalencia, se
 * usa; si no, se cae al nombre canónico del identificador. Un frame resuelto
 * que no exista en ningún atlas se sustituye por un placeholder procedural en
 * la capa Phaser (`pack-textures.ts`).
 */

/** Conjunto de frames que un `RoomPackage` exige del pack. */
export interface RequiredFrames {
  /** `tileId` no nulos presentes en alguna capa. */
  tiles: number[];
  /** Sprites de objetos (base y estados) y decoración, sin duplicados. */
  sprites: string[];
  /** `ItemDef.icon` de todos los items. */
  icons: string[];
}

/** Frame canónico de un `tileId` cuando el manifiesto no lo mapea. */
export function defaultTileFrame(tileId: number): string {
  return `tile-${tileId}`;
}

/** Frame canónico de un sprite cuando el manifiesto no lo mapea. */
export function defaultSpriteFrame(sprite: string): string {
  return sprite;
}

/** Frame canónico de un icono cuando el manifiesto no lo mapea. */
export function defaultIconFrame(icon: string): string {
  return icon;
}

/** Frame canónico del FX de brillo cuando el manifiesto no lo declara. */
export function defaultFxFrame(): string {
  return "fx-spark";
}

/**
 * Enumera todos los frames referenciados por un modelo del runtime. Es la
 * fuente de verdad para el validador del pack y para la generación de
 * placeholders.
 */
export function collectRequiredFrames(model: RuntimeModel): RequiredFrames {
  const tiles = new Set<number>();
  const sprites = new Set<string>();
  const icons = new Set<string>();

  for (const room of model.subrooms) {
    for (const layer of room.layers) {
      for (const tileId of layer.tiles) {
        if (tileId !== 0) {
          tiles.add(tileId);
        }
      }
    }
    for (const decoration of room.decorations) {
      sprites.add(decoration.sprite);
    }
    for (const object of room.objects) {
      sprites.add(object.sprite);
      for (const stateSprite of Object.values(object.spriteByState)) {
        sprites.add(stateSprite);
      }
    }
  }

  for (const item of model.items) {
    icons.add(item.icon);
  }

  return {
    tiles: [...tiles].sort((a, b) => a - b),
    sprites: [...sprites].sort(),
    icons: [...icons].sort(),
  };
}

/** Frame de un `tileId` según el manifiesto (o el canónico si falta). */
export function resolveTileFrame(manifest: PackManifest | undefined, tileId: number): string {
  return manifest?.tiles[String(tileId)]?.frame ?? defaultTileFrame(tileId);
}

/** Frame de un sprite del `RoomPackage` según el manifiesto (o el canónico si falta). */
export function resolveSpriteFrame(manifest: PackManifest | undefined, sprite: string): string {
  return manifest?.sprites[sprite]?.frame ?? defaultSpriteFrame(sprite);
}

/** Frame de un `ItemDef.icon` según el manifiesto (o el canónico si falta). */
export function resolveIconFrame(manifest: PackManifest | undefined, icon: string): string {
  return manifest?.ui.icons[icon] ?? defaultIconFrame(icon);
}

/** Frame del FX de brillo según el manifiesto (o el canónico si falta). */
export function resolveFxFrame(manifest: PackManifest | undefined): string {
  return manifest?.fx.spark ?? defaultFxFrame();
}

/**
 * ¿Colisiona un `tileId`? Solo el manifiesto lo decide; sin entrada, no
 * colisiona. El runtime **no** infiere la colisión del número de tile.
 */
export function tileCollides(manifest: PackManifest | undefined, tileId: number): boolean {
  return manifest?.tiles[String(tileId)]?.collides ?? false;
}

/** Origen (fracción del frame en `tileAnchor`) por defecto: abajo-centro. */
export const DEFAULT_FRAME_ORIGIN: readonly [number, number] = [0.5, 1];

/** Lienzo lógico (a 1×) de un `tileId` según el manifiesto, si lo declara. */
export function tileSize(
  manifest: PackManifest | undefined,
  tileId: number,
): readonly [number, number] | undefined {
  return manifest?.tiles[String(tileId)]?.size;
}

/** Origen de un `tileId` según el manifiesto (o `[0.5, 1]` por defecto). */
export function tileOrigin(
  manifest: PackManifest | undefined,
  tileId: number,
): readonly [number, number] {
  return manifest?.tiles[String(tileId)]?.origin ?? DEFAULT_FRAME_ORIGIN;
}

/** Lienzo lógico (a 1×) de un sprite del `RoomPackage`, si el manifiesto lo declara. */
export function spriteSize(
  manifest: PackManifest | undefined,
  sprite: string,
): readonly [number, number] | undefined {
  return manifest?.sprites[sprite]?.size;
}

/** Origen de un sprite del `RoomPackage` (o `[0.5, 1]` por defecto). */
export function spriteOrigin(
  manifest: PackManifest | undefined,
  sprite: string,
): readonly [number, number] {
  return manifest?.sprites[sprite]?.origin ?? DEFAULT_FRAME_ORIGIN;
}
